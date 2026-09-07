// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IPoolFactory.sol";
import "./MathLib.sol";

/// @dev Two-bucket reserve: mutualized `reserveBalance` and segregated `imFeesBalance`.
///      Callers for drawReserve/topUp/depositImFees must be factory-deployed pools.
contract TreasuryReserve is Ownable {
    using SafeERC20 for IERC20;
    using MathLib for uint256;

    // ── Storage ──────────────────────────────────────────────────────────────

    uint256 public reserveBalance;
    uint256 public imFeesBalance;

    // WAD-scaled risk / terminal-split params (multisig-settable)
    uint256 public reserveRate;      // fraction of protocol_fees to top up reserve
    uint256 public reserveTarget;    // absolute USDC target for reserve
    uint256 public protocolHurdleFrac; // hurdle before LP-bonus kicks in
    uint256 public lpBonusShare;     // LP-bonus share of excess above hurdle

    address public factory;
    address public stablecoin;

    // ── Events ────────────────────────────────────────────────────────────────

    event ReserveDrawn(address indexed pool, uint256 amount);
    event ReserveToppedUp(address indexed pool, uint256 amount);
    event ImFeesDeposited(address indexed pool, uint256 amount);
    event RiskParamsSet(uint256 reserveRate, uint256 reserveTarget, uint256 hurdleFrac, uint256 lpBonusShare);
    event ReserveWithdrawn(address indexed to, uint256 amount);
    event ImFeesWithdrawn(address indexed to, uint256 amount);
    event FactorySet(address factory);

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyPool() {
        require(IPoolFactory(factory).isPoolExist(msg.sender), "TR: not a pool");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(
        address _stablecoin,
        address _multisig,
        uint256 _reserveRate,
        uint256 _reserveTarget,
        uint256 _hurdleFrac,
        uint256 _lpBonusShare
    ) Ownable(_multisig) {
        require(_stablecoin != address(0), "TR: zero stablecoin");
        stablecoin = _stablecoin;
        reserveRate = _reserveRate;
        reserveTarget = _reserveTarget;
        protocolHurdleFrac = _hurdleFrac;
        lpBonusShare = _lpBonusShare;
    }

    // ── Governance ────────────────────────────────────────────────────────────

    function setFactory(address _factory) external onlyOwner {
        require(_factory != address(0), "TR: zero factory");
        factory = _factory;
        emit FactorySet(_factory);
    }

    function setRiskParams(
        uint256 _reserveRate,
        uint256 _reserveTarget,
        uint256 _hurdleFrac,
        uint256 _lpBonusShare
    ) external onlyOwner {
        reserveRate = _reserveRate;
        reserveTarget = _reserveTarget;
        protocolHurdleFrac = _hurdleFrac;
        lpBonusShare = _lpBonusShare;
        emit RiskParamsSet(_reserveRate, _reserveTarget, _hurdleFrac, _lpBonusShare);
    }

    function withdrawReserve(address to, uint256 amount) external onlyOwner {
        require(amount <= reserveBalance, "TR: exceeds reserve");
        reserveBalance -= amount;
        IERC20(stablecoin).safeTransfer(to, amount);
        emit ReserveWithdrawn(to, amount);
    }

    function withdrawImFees(address to, uint256 amount) external onlyOwner {
        require(amount <= imFeesBalance, "TR: exceeds imFees");
        imFeesBalance -= amount;
        IERC20(stablecoin).safeTransfer(to, amount);
        emit ImFeesWithdrawn(to, amount);
    }

    // ── Pool-callable ─────────────────────────────────────────────────────────

    /// @dev Draw up to `amount` from reserve; sends USDC to the calling pool.
    function drawReserve(uint256 amount) external onlyPool returns (uint256 drawn) {
        drawn = amount > reserveBalance ? reserveBalance : amount;
        if (drawn == 0) return 0;
        reserveBalance -= drawn;
        IERC20(stablecoin).safeTransfer(msg.sender, drawn);
        emit ReserveDrawn(msg.sender, drawn);
    }

    /// @dev Pool sends USDC in; increases reserveBalance.
    function topUp(uint256 amount) external onlyPool {
        if (amount == 0) return;
        reserveBalance += amount;
        IERC20(stablecoin).safeTransferFrom(msg.sender, address(this), amount);
        emit ReserveToppedUp(msg.sender, amount);
    }

    /// @dev Pool sends protocol-fee USDC in; increases imFeesBalance.
    function depositImFees(uint256 amount) external onlyPool {
        if (amount == 0) return;
        imFeesBalance += amount;
        IERC20(stablecoin).safeTransferFrom(msg.sender, address(this), amount);
        emit ImFeesDeposited(msg.sender, amount);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function reserveShortfallToTarget() external view returns (uint256) {
        return reserveTarget > reserveBalance ? reserveTarget - reserveBalance : 0;
    }

    function riskParams()
        external
        view
        returns (uint256 _reserveRate, uint256 _reserveTarget, uint256 _hurdleFrac, uint256 _lpBonusShare)
    {
        return (reserveRate, reserveTarget, protocolHurdleFrac, lpBonusShare);
    }

    function getReserveStatus()
        external
        view
        returns (uint256 _reserveBalance, uint256 _reserveTarget, uint256 _imFeesBalance)
    {
        return (reserveBalance, reserveTarget, imFeesBalance);
    }
}
