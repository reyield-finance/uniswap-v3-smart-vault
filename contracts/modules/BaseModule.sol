// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "../interfaces/IRegistry.sol";
import "../interfaces/IPositionManager.sol";

contract BaseModule {
    IRegistry public immutable registry;

    modifier onlyWhitelistedKeeper() {
        require(registry.whitelistedKeepers(msg.sender), "WHL");
        _;
    }

    constructor(address _registry) {
        registry = IRegistry(_registry);
    }
}
