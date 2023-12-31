// SPDX-License-Identifier: GPL-2.0
pragma solidity 0.7.6;
pragma abicoder v2;

import "./interfaces/IPositionManager.sol";
import "./interfaces/IUniswapAddressHolder.sol";
import "./interfaces/IRegistryAddressHolder.sol";
import "./interfaces/IDiamondCut.sol";
import "./interfaces/IRegistry.sol";

struct FacetAddressAndPosition {
    address facetAddress;
    uint96 functionSelectorPosition; // position in facetFunctionSelectors.functionSelectors array
}

struct FacetFunctionSelectors {
    bytes4[] functionSelectors;
    uint256 facetAddressPosition; // position of facetAddress in facetAddresses array
}

struct StorageStruct {
    // maps function selector to the facet address and
    // the position of the selector in the facetFunctionSelectors.selectors array
    mapping(bytes4 => FacetAddressAndPosition) selectorToFacetAndPosition;
    // maps facet addresses to function selectors
    mapping(address => FacetFunctionSelectors) facetFunctionSelectors;
    // facet addresses
    address[] facetAddresses;
    address owner;
    IRegistryAddressHolder registryAddressHolder;
    IUniswapAddressHolder uniswapAddressHolder;
    mapping(bytes32 => bytes32) storageVars;
}

library PositionManagerStorage {
    bytes32 private constant key = keccak256("position-manager-storage-location");

    ///@notice get the storage from memory location
    ///@return s the storage struct
    function getStorage() internal pure returns (StorageStruct storage s) {
        bytes32 k = key;
        assembly {
            s.slot := k
        }
    }

    ///@notice emitted when a contract changes ownership
    ///@param previousOwner previous owner of the contract
    ///@param newOwner new owner of the contract
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    ///@notice set the owner field on the storage struct
    ///@param _newOwner new owner of the storage struct
    function setContractOwner(address _newOwner) internal {
        require(_newOwner != address(0), "SNO");
        StorageStruct storage ds = getStorage();
        address previousOwner = ds.owner;
        ds.owner = _newOwner;
        if (_newOwner != previousOwner) {
            emit OwnershipTransferred(previousOwner, _newOwner);
        }
    }

    ///@notice make sure that a function is called by the PositionManagerFactory contract
    function enforceIsGovernance() internal view {
        require(
            msg.sender == IRegistry(getStorage().registryAddressHolder.registry()).positionManagerFactoryAddress(),
            "SMF"
        );
    }

    ///@notice emitted when a facet is cut into the diamond
    ///@param _diamondCut facet cut
    ///@param _init diamond cut init address
    ///@param _calldata facet cut calldata
    event DiamondCut(IDiamondCut.FacetCut[] _diamondCut, address _init, bytes _calldata);

    ///@notice Internal function version of diamondCut
    ///@param _diamondCut facet cut
    ///@param _init diamond cut init address
    ///@param _calldata facet cut calldata
    function diamondCut(IDiamondCut.FacetCut[] memory _diamondCut, address _init, bytes memory _calldata) internal {
        uint256 _diamondCutLength = _diamondCut.length;
        for (uint256 facetIndex; facetIndex < _diamondCutLength; ++facetIndex) {
            IDiamondCut.FacetCutAction action = _diamondCut[facetIndex].action;
            if (action == IDiamondCut.FacetCutAction.Add) {
                addFunctions(_diamondCut[facetIndex].facetAddress, _diamondCut[facetIndex].functionSelectors);
            } else if (action == IDiamondCut.FacetCutAction.Replace) {
                replaceFunctions(_diamondCut[facetIndex].facetAddress, _diamondCut[facetIndex].functionSelectors);
            } else if (action == IDiamondCut.FacetCutAction.Remove) {
                removeFunctions(_diamondCut[facetIndex].functionSelectors);
            } else {
                revert("SIF");
            }
        }
        emit DiamondCut(_diamondCut, _init, _calldata);
        initializeDiamondCut(_init, _calldata);
    }

    ///@notice Add functions to facet
    ///@param _facetAddress address of the facet
    ///@param _functionSelectors function selectors to add
    function addFunctions(address _facetAddress, bytes4[] memory _functionSelectors) internal {
        require(_functionSelectors.length != 0, "SNS");
        StorageStruct storage ds = getStorage();
        require(_facetAddress != address(0), "SA0");
        uint96 selectorPosition = uint96(ds.facetFunctionSelectors[_facetAddress].functionSelectors.length);

        // add new facet address if it does not exist
        if (selectorPosition == 0) {
            addFacet(ds, _facetAddress);
        }

        uint256 _functionSelectorsLength = _functionSelectors.length;
        for (uint256 selectorIndex; selectorIndex < _functionSelectorsLength; ++selectorIndex) {
            bytes4 selector = _functionSelectors[selectorIndex];
            address oldFacetAddress = ds.selectorToFacetAndPosition[selector].facetAddress;
            require(oldFacetAddress == address(0), "SFE");
            addFunction(ds, selector, selectorPosition, _facetAddress);
            selectorPosition++;
        }
    }

    ///@notice Add facet by address
    ///@param ds storage struct
    ///@param _facetAddress address of the facet
    function addFacet(StorageStruct storage ds, address _facetAddress) internal {
        ds.facetFunctionSelectors[_facetAddress].facetAddressPosition = ds.facetAddresses.length;
        ds.facetAddresses.push(_facetAddress);
    }

    ///@notice Add single function to facet
    ///@param ds storage struct
    ///@param _selector function selector to add
    ///@param _selectorPosition position of the function selector in the facetFunctionSelectors array
    function addFunction(
        StorageStruct storage ds,
        bytes4 _selector,
        uint96 _selectorPosition,
        address _facetAddress
    ) internal {
        ds.selectorToFacetAndPosition[_selector].functionSelectorPosition = _selectorPosition;
        ds.facetFunctionSelectors[_facetAddress].functionSelectors.push(_selector);
        ds.selectorToFacetAndPosition[_selector].facetAddress = _facetAddress;
    }

    ///@notice Remove single function from facet
    ///@param ds storage struct
    ///@param _facetAddress address of the facet
    ///@param _selector function selector to remove
    function removeFunction(StorageStruct storage ds, address _facetAddress, bytes4 _selector) internal {
        require(_facetAddress != address(0), "SRE");
        require(_facetAddress != address(this), "SRI");

        // replace selector with last selector, then delete last selector
        uint256 selectorPosition = ds.selectorToFacetAndPosition[_selector].functionSelectorPosition;
        uint256 lastSelectorPosition = ds.facetFunctionSelectors[_facetAddress].functionSelectors.length - 1;

        // if not the same then replace _selector with lastSelector
        if (selectorPosition != lastSelectorPosition) {
            bytes4 lastSelector = ds.facetFunctionSelectors[_facetAddress].functionSelectors[lastSelectorPosition];
            ds.facetFunctionSelectors[_facetAddress].functionSelectors[selectorPosition] = lastSelector;
            ds.selectorToFacetAndPosition[lastSelector].functionSelectorPosition = uint96(selectorPosition);
        }

        // delete the last selector
        ds.facetFunctionSelectors[_facetAddress].functionSelectors.pop();
        delete ds.selectorToFacetAndPosition[_selector];

        // if no more selectors for facet address then delete the facet address
        if (lastSelectorPosition == 0) {
            // replace facet address with last facet address and delete last facet address
            uint256 lastFacetAddressPosition = ds.facetAddresses.length - 1;
            uint256 facetAddressPosition = ds.facetFunctionSelectors[_facetAddress].facetAddressPosition;
            if (facetAddressPosition != lastFacetAddressPosition) {
                address lastFacetAddress = ds.facetAddresses[lastFacetAddressPosition];
                ds.facetAddresses[facetAddressPosition] = lastFacetAddress;
                ds.facetFunctionSelectors[lastFacetAddress].facetAddressPosition = facetAddressPosition;
            }
            ds.facetAddresses.pop();
            delete ds.facetFunctionSelectors[_facetAddress].facetAddressPosition;
        }
    }

    ///@notice Replace functions in facet
    ///@param _facetAddress address of the facet
    ///@param _functionSelectors function selectors to replace
    function replaceFunctions(address _facetAddress, bytes4[] memory _functionSelectors) internal {
        require(_functionSelectors.length != 0, "SRF");
        StorageStruct storage ds = getStorage();
        require(_facetAddress != address(0), "SR0");
        uint96 selectorPosition = uint96(ds.facetFunctionSelectors[_facetAddress].functionSelectors.length);

        // add new facet address if it does not exist
        if (selectorPosition == 0) {
            addFacet(ds, _facetAddress);
        }

        uint256 _functionSelectorsLength = _functionSelectors.length;
        for (uint256 selectorIndex; selectorIndex < _functionSelectorsLength; ++selectorIndex) {
            bytes4 selector = _functionSelectors[selectorIndex];
            address oldFacetAddress = ds.selectorToFacetAndPosition[selector].facetAddress;

            require(oldFacetAddress != _facetAddress, "SRR");

            removeFunction(ds, oldFacetAddress, selector);
            addFunction(ds, selector, selectorPosition, _facetAddress);
            selectorPosition++;
        }
    }

    ///@notice remove functions in facet
    ///@param _functionSelectors function selectors to remove
    function removeFunctions(bytes4[] memory _functionSelectors) internal {
        require(_functionSelectors.length != 0, "SES");

        StorageStruct storage ds = getStorage();

        uint256 _functionSelectorsLength = _functionSelectors.length;
        for (uint256 selectorIndex; selectorIndex < _functionSelectorsLength; ++selectorIndex) {
            bytes4 selector = _functionSelectors[selectorIndex];
            address oldFacetAddress = ds.selectorToFacetAndPosition[selector].facetAddress;
            removeFunction(ds, oldFacetAddress, selector);
        }
    }

    ///@notice Initialize the diamond cut
    ///@param _init delegatecall address
    ///@param _calldata delegatecall data
    function initializeDiamondCut(address _init, bytes memory _calldata) internal {
        if (_init == address(0)) {
            require(_calldata.length == 0, "SI0");
        } else {
            require(_calldata.length != 0, "SIC");

            (bool success, bytes memory error) = _init.delegatecall(_calldata);

            if (!success) {
                if (error.length != 0) {
                    revert(string(error));
                } else {
                    revert("SIR");
                }
            }
        }
    }
}
