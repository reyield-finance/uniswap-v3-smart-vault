// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "../interfaces/IRegistry.sol";
import "../interfaces/IPositionManager.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract BaseRecipes is Pausable {
    IRegistry public registry;

    modifier onlyGovernance() {
        require(msg.sender == registry.governance(), "BROG");
        _;
    }

    constructor(address _registry) Pausable() {
        require(_registry != address(0), "BRR0");
        registry = IRegistry(_registry);
    }

    ///@notice change registry address
    ///@param _registry address of new registry
    function changeRegistry(address _registry) external onlyGovernance {
        require(_registry != address(0), "BRCR");
        registry = IRegistry(_registry);
    }

    function pause() external onlyGovernance {
        _pause();
    }

    function unpause() external onlyGovernance {
        _unpause();
    }
}
