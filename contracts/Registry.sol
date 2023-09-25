// SPDX-License-Identifier: GPL-2.0
pragma solidity 0.7.6;
pragma abicoder v2;

import "./interfaces/IRegistry.sol";
import "@openzeppelin/contracts/introspection/ERC165.sol";

/// @title Stores all the governance variables
contract Registry is IRegistry, ERC165 {
    address public override governance;
    address public override positionManagerFactoryAddress;
    address public override strategyProviderWalletFactoryAddress;
    address public override officialAccount;

    // for security of swap
    int24 public override maxTwapDeviation;
    uint32 public override twapDuration;

    // for quote token
    address public override usdValueTokenAddress;
    address public override weth9;

    // for keeper
    mapping(address => bool) public override whitelistedKeepers;

    // for modules
    mapping(bytes32 => Entry) public modules;
    bytes32[] public moduleKeys;
    mapping(address => bool) public override activeModule;

    // uniswap allowable fee tiers
    mapping(uint24 => bool) public allowableFeeTiers;
    uint24[] public feeTiers;

    // for service fee of strategy provider
    uint32 public override serviceFeeDenominator = 100_000_000;
    address public override serviceFeeRecipient;
    uint32 private serviceFeeRatioLength;
    mapping(uint32 => uint32) public licensesToServiceFeeRatio;

    constructor(
        address _governance,
        address _serviceFeeRecipient,
        int24 _maxTwapDeviation,
        uint32 _twapDuration,
        address _usdValueTokenAddress,
        address _weth9
    ) {
        _registerInterface(type(IRegistry).interfaceId);

        require(_governance != address(0), "RCG");
        require(_serviceFeeRecipient != address(0), "RCSFR");
        require(_usdValueTokenAddress != address(0), "RCUTA");
        require(_weth9 != address(0), "RCW");

        governance = _governance;
        serviceFeeRecipient = _serviceFeeRecipient;
        maxTwapDeviation = _maxTwapDeviation;
        twapDuration = _twapDuration;
        usdValueTokenAddress = _usdValueTokenAddress;
        weth9 = _weth9;

        initAllowableFeeTiers();
        initServiceRatioes();
    }

    function initAllowableFeeTiers() private {
        feeTiers.push(100);
        allowableFeeTiers[100] = true;
        feeTiers.push(500);
        allowableFeeTiers[500] = true;
        feeTiers.push(3000);
        allowableFeeTiers[3000] = true;
        feeTiers.push(10000);
        allowableFeeTiers[10000] = true;
    }

    function initServiceRatioes() private {
        serviceFeeDenominator = 100_000_000;
        serviceFeeRatioLength = 20;

        // 15.000000%
        licensesToServiceFeeRatio[1] = 15_000_000;

        // 13.781718%
        licensesToServiceFeeRatio[2] = 13_781_718;

        // 12.662384%
        licensesToServiceFeeRatio[3] = 12_662_384;

        // 11.633960%
        licensesToServiceFeeRatio[4] = 11_633_960;

        // 10.689064%
        licensesToServiceFeeRatio[5] = 10_689_064;

        // 9.820911%
        licensesToServiceFeeRatio[6] = 9_820_911;

        // 9.023269%
        licensesToServiceFeeRatio[7] = 9_023_269;

        // 8.290410%
        licensesToServiceFeeRatio[8] = 8_290_410;

        // 7.617073%
        licensesToServiceFeeRatio[9] = 7_617_073;

        // 6.998423%
        licensesToServiceFeeRatio[10] = 6_998_423;

        // 6.430020%
        licensesToServiceFeeRatio[11] = 6_430_020;

        // 5.907781%
        licensesToServiceFeeRatio[12] = 5_907_781;

        // 5.427958%
        licensesToServiceFeeRatio[13] = 5_427_958;

        // 4.987106%
        licensesToServiceFeeRatio[14] = 4_987_106;

        // 4.582060%
        licensesToServiceFeeRatio[15] = 4_582_060;

        // 4.209910%
        licensesToServiceFeeRatio[16] = 4_209_910;

        // 3.867986%
        licensesToServiceFeeRatio[17] = 3_867_986;

        // 3.553833%
        licensesToServiceFeeRatio[18] = 3_553_833;

        // 3.265195%
        licensesToServiceFeeRatio[19] = 3_265_195;

        // 3.000000%
        licensesToServiceFeeRatio[20] = 3_000_000;
    }

    ///@notice modifier to check if the sender is the governance contract
    modifier onlyGovernance() {
        require(msg.sender == governance, "ROG");
        _;
    }

    ///@notice change the address of the governance
    ///@param _governance the address of the new governance
    function changeGovernance(address _governance) external onlyGovernance {
        require(_governance != address(0), "RG0");
        address oldGovernance = governance;
        governance = _governance;
        emit GovernanceChanged(oldGovernance, _governance);
    }

    ///@notice change the address of the service fee recipient
    ///@param _serviceFeeRecipient the address of the new service fee recipient
    function changeServiceFeeRecipient(address _serviceFeeRecipient) external onlyGovernance {
        require(_serviceFeeRecipient != address(0), "RS0");
        address oldServiceFeeRecipient = serviceFeeRecipient;
        serviceFeeRecipient = _serviceFeeRecipient;
        emit ServiceFeeRecipientChanged(oldServiceFeeRecipient, _serviceFeeRecipient);
    }

    ///@notice check if the fee tier is allowable
    ///@param feeTier the fee tier to check
    ///@return true if the fee tier is allowable, false otherwise
    function isAllowableFeeTier(uint24 feeTier) external view override returns (bool) {
        return allowableFeeTiers[feeTier];
    }

    ///@notice get the list of fee tiers
    ///@return array of fee tiers
    function getFeeTiers() external view override returns (uint24[] memory) {
        return feeTiers;
    }

    ///@notice get the list of allowable fee tiers
    ///@return array of allowable fee tiers
    function getAllowableFeeTiers() external view override returns (uint24[] memory) {
        uint24[] memory allowableFeeTiersList = new uint24[](feeTiers.length);

        for (uint256 i; i < feeTiers.length; ++i) {
            if (!allowableFeeTiers[feeTiers[i]]) {
                continue;
            }
            allowableFeeTiersList[i] = feeTiers[i];
        }

        return allowableFeeTiersList;
    }

    ///@notice sets the Position manager factory address
    ///@param _positionManagerFactory the address of the position manager factory
    function setPositionManagerFactory(address _positionManagerFactory) external onlyGovernance {
        require(_positionManagerFactory != address(0), "RF0");
        address oldPositionManagerFactoryAddress = positionManagerFactoryAddress;
        positionManagerFactoryAddress = _positionManagerFactory;
        emit PositionManagerFactoryChanged(oldPositionManagerFactoryAddress, _positionManagerFactory);
    }

    ///@notice sets the strategy provider collect wallet factory address
    ///@param _strategyProviderWalletFactory the address of the strategy provider collect wallet factory
    function setStrategyProviderWalletFactory(address _strategyProviderWalletFactory) external onlyGovernance {
        require(_strategyProviderWalletFactory != address(0), "RF0");
        address oldStrategyProviderWalletFactoryAddress = strategyProviderWalletFactoryAddress;
        strategyProviderWalletFactoryAddress = _strategyProviderWalletFactory;
        emit StrategyProviderWalletFactoryChanged(
            oldStrategyProviderWalletFactoryAddress,
            _strategyProviderWalletFactory
        );
    }

    ///@notice sets the official account address
    ///@param _officialAccount the address of the official account
    function setOfficialAccount(address _officialAccount) external onlyGovernance {
        require(_officialAccount != address(0), "ROA0");
        address oldOfficialAccount = officialAccount;
        officialAccount = _officialAccount;
        emit OfficialAccountChanged(oldOfficialAccount, _officialAccount);
    }

    function setServiceFeeRatio(uint32 _licenseAmount, uint32 _serviceFeeRatio) external onlyGovernance {
        licensesToServiceFeeRatio[_licenseAmount] = _serviceFeeRatio;
        if (_licenseAmount > serviceFeeRatioLength) {
            serviceFeeRatioLength = _licenseAmount;
        }
        emit ServiceFeeRatioUpdated(_licenseAmount, _serviceFeeRatio);
    }

    ///@notice Register a contract
    ///@param _id keccak256 of contract name
    ///@param _contractAddress address of the new contract
    ///@param _defaultValue default value of the contract
    function addNewContract(bytes32 _id, address _contractAddress, bytes32 _defaultValue) external onlyGovernance {
        require(
            modules[_id].contractAddress == address(0) &&
                _contractAddress != address(0) &&
                !activeModule[_contractAddress],
            "RAC"
        );
        modules[_id] = Entry({ id: _id, contractAddress: _contractAddress, defaultData: _defaultValue });
        activeModule[_contractAddress] = true;
        moduleKeys.push(_id);
        emit ContractAdded(_contractAddress, _id);
    }

    ///@notice Changes a contract's address
    ///@param _id keccak256 of contract id string
    ///@param _newContractAddress address of the new contract
    function changeContract(bytes32 _id, address _newContractAddress) external onlyGovernance {
        require(
            modules[_id].contractAddress != address(0) &&
                _newContractAddress != address(0) &&
                !activeModule[_newContractAddress] &&
                activeModule[modules[_id].contractAddress],
            "RCC"
        );
        address origMoudleAddress = modules[_id].contractAddress;
        delete activeModule[origMoudleAddress];
        activeModule[_newContractAddress] = true;
        modules[_id].contractAddress = _newContractAddress;
        emit ContractChanged(origMoudleAddress, _newContractAddress, _id);
    }

    ///@notice Removes a contract
    ///@param _id keccak256 of contract id string
    function removeContract(bytes32 _id) external onlyGovernance {
        require(modules[_id].contractAddress != address(0) && activeModule[modules[_id].contractAddress], "RRC");
        address origMoudleAddress = modules[_id].contractAddress;
        delete activeModule[origMoudleAddress];
        delete modules[_id];
        for (uint256 i; i < moduleKeys.length; ++i) {
            if (moduleKeys[i] == _id) {
                moduleKeys[i] = moduleKeys[moduleKeys.length - 1];
                moduleKeys.pop();
                break;
            }
        }
        emit ContractRemoved(origMoudleAddress, _id);
    }

    ///@notice adds a new whitelisted keeper
    ///@param _keeper address of the new keeper
    function addKeeperToWhitelist(address _keeper) external onlyGovernance {
        require(!whitelistedKeepers[_keeper], "RKW");
        whitelistedKeepers[_keeper] = true;
        emit KeeperAdded(_keeper);
    }

    ///@notice remove a whitelisted keeper
    ///@param _keeper address of the keeper to remove
    function removeKeeperFromWhitelist(address _keeper) external onlyGovernance {
        require(whitelistedKeepers[_keeper], "RKN");
        whitelistedKeepers[_keeper] = false;
        emit KeeperRemoved(_keeper);
    }

    ///@notice Get the keys for all modules
    ///@return bytes32[] all module keys
    function getModuleKeys() external view override returns (bytes32[] memory) {
        return moduleKeys;
    }

    ///@notice Set default data for a module
    ///@param _id keccak256 of module id string
    ///@param _defaultData default data for the module
    function setDefaultData(bytes32 _id, bytes32 _defaultData) external onlyGovernance {
        require(modules[_id].contractAddress != address(0), "RDE");
        require(_defaultData != bytes32(0), "RD0");

        modules[_id].defaultData = _defaultData;
        emit ModuleDataUpdated(_id, modules[_id].contractAddress, _defaultData);
    }

    ///@notice set oracle price deviation threshold
    ///@param _maxTwapDeviation the new oracle price deviation threshold
    function setMaxTwapDeviation(int24 _maxTwapDeviation) external onlyGovernance {
        int24 oldMaxTwapDeviation = maxTwapDeviation;
        maxTwapDeviation = _maxTwapDeviation;
        emit MaxTwapDeviationUpdated(oldMaxTwapDeviation, _maxTwapDeviation);
    }

    ///@notice set twap duration
    ///@param _twapDuration the new twap duration
    function setTwapDuration(uint32 _twapDuration) external onlyGovernance {
        uint32 oldTwapDuration = twapDuration;
        twapDuration = _twapDuration;
        emit TwapDurationUpdated(oldTwapDuration, _twapDuration);
    }

    ///@notice set address of usd value token
    ///@param _usdValueAddress the address of new usd value token
    function setUsdValueTokenAddress(address _usdValueAddress) external onlyGovernance {
        require(_usdValueAddress != address(0), "RUA");
        address oldUsdValueTokenAddress = usdValueTokenAddress;
        usdValueTokenAddress = _usdValueAddress;
        emit UsdValueTokenAddressUpdated(oldUsdValueTokenAddress, _usdValueAddress);
    }

    ///@notice set address of weth9
    ///@param _weth9 the address of new weth9
    function setWETH9(address _weth9) external onlyGovernance {
        require(_weth9 != address(0), "RWA");
        address oldWeth9 = weth9;
        weth9 = _weth9;
        emit Weth9Updated(oldWeth9, _weth9);
    }

    ///@notice Get the address of a module for a given key
    ///@param _id keccak256 of module id string
    ///@return entry of the module
    function getModuleInfo(bytes32 _id) external view override returns (Entry memory) {
        return modules[_id];
    }

    ///@notice activates a fee tier
    ///@param fee fee tier to be activated
    function activateFeeTier(uint24 fee) external onlyGovernance {
        require(!allowableFeeTiers[fee], "DRAFT");
        allowableFeeTiers[fee] = true;
        feeTiers.push(fee);
        emit FeeTierActivated(fee);
    }

    ///@notice deactivates a fee tier
    ///@param fee fee tier to be deactivated
    function deactivateFeeTier(uint24 fee) external onlyGovernance {
        require(allowableFeeTiers[fee], "DRAFT");
        allowableFeeTiers[fee] = false;
        uint256 feeTiersLength = feeTiers.length;
        if (feeTiersLength == 1) {
            feeTiers.pop();
        } else {
            for (uint256 i; i < feeTiersLength; ++i) {
                if (feeTiers[i] == fee) {
                    feeTiers[i] = feeTiers[feeTiersLength - 1];
                    feeTiers.pop();
                    break;
                }
            }
        }
        emit FeeTierDeactivated(fee);
    }

    ///@notice get service fee ratio for a given license amount
    ///@param _licenseAmount license amount to get service fee ratio
    function getServiceFeeRatioFromLicenseAmount(uint32 _licenseAmount) external view override returns (uint32 ratio) {
        require(_licenseAmount != 0, "RLA0");
        if (_licenseAmount < serviceFeeRatioLength) {
            return licensesToServiceFeeRatio[_licenseAmount];
        } else {
            return licensesToServiceFeeRatio[serviceFeeRatioLength];
        }
    }
}
