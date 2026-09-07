// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @dev WAD = 1e18 fixed-point helpers.
library MathLib {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant SECONDS_PER_DAY = 86400;
    uint256 internal constant SECONDS_PER_YEAR = 365 * 86400; // fixed 365-day year; deliberate — matches Python oracle; leap days are not accounted for

    /// @dev Multiply two WAD values, rounding down.
    function wadMul(uint256 a, uint256 b) internal pure returns (uint256) {
        return mulDiv(a, b, WAD);
    }

    /// @dev Divide two WAD values, rounding down.
    function wadDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return mulDiv(a, WAD, b);
    }

    /// @dev Full-precision multiply-then-divide, rounding down.
    ///      Reverts on overflow or division by zero.
    function mulDiv(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256 result) {
        require(denominator != 0, "MathLib: div by zero");
        // 512-bit multiply [prod1, prod0] = x * y
        uint256 prod0;
        uint256 prod1;
        assembly {
            let mm := mulmod(x, y, not(0))
            prod0 := mul(x, y)
            prod1 := sub(sub(mm, prod0), lt(mm, prod0))
        }
        if (prod1 == 0) {
            return prod0 / denominator;
        }
        require(prod1 < denominator, "MathLib: overflow");
        uint256 remainder;
        assembly {
            remainder := mulmod(x, y, denominator)
            prod1 := sub(prod1, gt(remainder, prod0))
            prod0 := sub(prod0, remainder)
        }
        uint256 twos = denominator & (~denominator + 1);
        assembly {
            denominator := div(denominator, twos)
            prod0 := div(prod0, twos)
            twos := add(div(sub(0, twos), twos), 1)
        }
        prod0 |= prod1 * twos;
        uint256 inv = (3 * denominator) ^ 2;
        inv *= 2 - denominator * inv;
        inv *= 2 - denominator * inv;
        inv *= 2 - denominator * inv;
        inv *= 2 - denominator * inv;
        inv *= 2 - denominator * inv;
        inv *= 2 - denominator * inv;
        result = prod0 * inv;
    }

    /// @dev Calendar-day index (UTC day number).
    function dayOf(uint256 ts) internal pure returns (uint256) {
        return ts / SECONDS_PER_DAY;
    }
}
