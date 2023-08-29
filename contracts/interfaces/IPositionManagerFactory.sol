// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface IPositionManagerFactory {
    function create() external returns (address);

    function userToPositionManager(address _user) external view returns (address);
}
