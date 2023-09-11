// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "../interfaces/IRegistry.sol";
import "../interfaces/IPositionManager.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract BaseModule is Pausable {
    IRegistry public registry;

    modifier onlyWhitelistedKeeper() {
        require(registry.whitelistedKeepers(msg.sender), "OWLK");
        _;
    }

    modifier onlyGovernance() {
        require(msg.sender == registry.governance(), "BMOG");
        _;
    }

    constructor(address _registry) {
        require(_registry != address(0), "BMR0");
        registry = IRegistry(_registry);
    }

    ///@notice change registry address
    ///@param _registry address of new registry
    function changeRegistry(address _registry) external onlyGovernance {
        require(_registry != address(0), "BMCR");
        registry = IRegistry(_registry);
    }

    function pause() external onlyGovernance {
        _pause();
    }

    function unpause() external onlyGovernance {
        _unpause();
    }
}
