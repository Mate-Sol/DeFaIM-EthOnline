// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface ITreasuryReserve {
    /// @dev Pool requests reserve to cover a shortfall (default settlement).
    ///      Transfers min(amount, reserveBalance) USDC to the caller; returns amount drawn.
    function drawReserve(uint256 amount) external returns (uint256 drawn);

    /// @dev Successful close: pool transfers USDC in to top up the reserve.
    function topUp(uint256 amount) external;

    /// @dev Sweep: pool routes its protocolFees to the segregated IM-fee balance.
    function depositImFees(uint256 amount) external;

    /// @dev max(reserveTarget - reserveBalance, 0)
    function reserveShortfallToTarget() external view returns (uint256);

    function riskParams()
        external
        view
        returns (uint256 reserveRate, uint256 reserveTarget, uint256 hurdleFrac, uint256 lpBonusShare);
}
