// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IPoolFactory {
    function isPoolExist(address pool) external view returns (bool);
    function releasePsp(address psp) external;
}
