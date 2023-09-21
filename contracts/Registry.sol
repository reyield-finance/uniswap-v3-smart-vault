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

    // uniswap allowable fee tiers
    mapping(uint24 => bool) public allowableFeeTiers;
    uint24[] public feeTiers;

    // for service fee of strategy provider
    uint32 public override serviceFeeDenominator = 100_000_000;
    address public override serviceFeeRecipient;
    uint32 private serviceFeeRatioLength;
    mapping(uint32 => uint32) public licnesesToServiceFeeRatio;

    ///@notice emitted when governance address is changed
    ///@param newGovernance the new governance address
    event GovernanceChanged(address newGovernance);

    ///@notice emitted when service fee recipient address is changed
    ///@param newServiceFeeRecipient the new service fee recipient address
    event ServiceFeeRecipientChanged(address newServiceFeeRecipient);

    ///@notice emitted when a contract is added to registry
    ///@param newContract address of the new contract
    ///@param contractId keccak of contract name
    event ContractAdded(address newContract, bytes32 contractId);

    ///@notice emitted when a contract address is updated
    ///@param oldContract address of the contract before update
    ///@param newContract address of the contract after update
    ///@param contractId keccak of contract name
    event ContractChanged(address oldContract, address newContract, bytes32 contractId);

    ///@notice emitted when a contract address is removed
    ///@param contractAddress address of the removed contract
    ///@param contractId keccak of removed contract name
    event ContractRemoved(address contractAddress, bytes32 contractId);

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
        licnesesToServiceFeeRatio[1] = 15_000_000;

        // 13.781718%
        licnesesToServiceFeeRatio[2] = 13_781_718;

        // 12.662384%
        licnesesToServiceFeeRatio[3] = 12_662_384;

        // 11.633960%
        licnesesToServiceFeeRatio[4] = 11_633_960;

        // 10.689064%
        licnesesToServiceFeeRatio[5] = 10_689_064;

        // 9.820911%
        licnesesToServiceFeeRatio[6] = 9_820_911;

        // 9.023269%
        licnesesToServiceFeeRatio[7] = 9_023_269;

        // 8.290410%
        licnesesToServiceFeeRatio[8] = 8_290_410;

        // 7.617073%
        licnesesToServiceFeeRatio[9] = 7_617_073;

        // 6.998423%
        licnesesToServiceFeeRatio[10] = 6_998_423;

        // 6.430020%
        licnesesToServiceFeeRatio[11] = 6_430_020;

        // 5.907781%
        licnesesToServiceFeeRatio[12] = 5_907_781;

        // 5.427958%
        licnesesToServiceFeeRatio[13] = 5_427_958;

        // 4.987106%
        licnesesToServiceFeeRatio[14] = 4_987_106;

        // 4.582060%
        licnesesToServiceFeeRatio[15] = 4_582_060;

        // 4.209910%
        licnesesToServiceFeeRatio[16] = 4_209_910;

        // 3.867986%
        licnesesToServiceFeeRatio[17] = 3_867_986;

        // 3.553833%
        licnesesToServiceFeeRatio[18] = 3_553_833;

        // 3.265195%
        licnesesToServiceFeeRatio[19] = 3_265_195;

        // 3.000000%
        licnesesToServiceFeeRatio[20] = 3_000_000;
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
        governance = _governance;
        emit GovernanceChanged(_governance);
    }

    ///@notice change the address of the service fee recipient
    ///@param _serviceFeeRecipient the address of the new service fee recipient
    function changeServiceFeeRecipient(address _serviceFeeRecipient) external onlyGovernance {
        require(_serviceFeeRecipient != address(0), "RS0");
        serviceFeeRecipient = _serviceFeeRecipient;
        emit ServiceFeeRecipientChanged(_serviceFeeRecipient);
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
        positionManagerFactoryAddress = _positionManagerFactory;
    }

    ///@notice sets the strategy provider collect wallet factory address
    ///@param _strategyProviderWalletFactory the address of the strategy provider collect wallet factory
    function setStrategyProviderWalletFactory(address _strategyProviderWalletFactory) external onlyGovernance {
        require(_strategyProviderWalletFactory != address(0), "RF0");
        strategyProviderWalletFactoryAddress = _strategyProviderWalletFactory;
    }

    ///@notice sets the official account address
    ///@param _officialAccount the address of the official account
    function setOfficialAccount(address _officialAccount) external onlyGovernance {
        require(_officialAccount != address(0), "ROA0");
        officialAccount = _officialAccount;
    }

    function setServiceFeeRatio(uint32 _licenseAmount, uint32 _serviceFeeRatio) external onlyGovernance {
        licnesesToServiceFeeRatio[_licenseAmount] = _serviceFeeRatio;
        if (_licenseAmount > serviceFeeRatioLength) {
            serviceFeeRatioLength = _licenseAmount;
        }
    }

    ///@notice Register a contract
    ///@param _id keccak256 of contract name
    ///@param _contractAddress address of the new contract
    ///@param _defaultValue default value of the contract
    function addNewContract(bytes32 _id, address _contractAddress, bytes32 _defaultValue) external onlyGovernance {
        require(modules[_id].contractAddress == address(0), "RAE");
        require(_contractAddress != address(0), "RA0");
        modules[_id] = Entry({ contractAddress: _contractAddress, defaultData: _defaultValue });
        moduleKeys.push(_id);
        emit ContractAdded(_contractAddress, _id);
    }

    ///@notice Changes a contract's address
    ///@param _id keccak256 of contract id string
    ///@param _newContractAddress address of the new contract
    function changeContract(bytes32 _id, address _newContractAddress) external onlyGovernance {
        require(modules[_id].contractAddress != address(0), "RCE");
        require(_newContractAddress != address(0), "RCE0");
        address origMoudleAddress = modules[_id].contractAddress;
        modules[_id].contractAddress = _newContractAddress;
        emit ContractChanged(origMoudleAddress, _newContractAddress, _id);
    }

    ///@notice Removes a contract
    ///@param _id keccak256 of contract id string
    function removeContract(bytes32 _id) external onlyGovernance {
        require(modules[_id].contractAddress != address(0), "RRE");
        address origMoudleAddress = modules[_id].contractAddress;
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
    }

    ///@notice remove a whitelisted keeper
    ///@param _keeper address of the keeper to remove
    function removeKeeperFromWhitelist(address _keeper) external onlyGovernance {
        require(whitelistedKeepers[_keeper], "RKN");
        whitelistedKeepers[_keeper] = false;
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
    }

    ///@notice set oracle price deviation threshold
    ///@param _maxTwapDeviation the new oracle price deviation threshold
    function setMaxTwapDeviation(int24 _maxTwapDeviation) external onlyGovernance {
        maxTwapDeviation = _maxTwapDeviation;
    }

    ///@notice set twap duration
    ///@param _twapDuration the new twap duration
    function setTwapDuration(uint32 _twapDuration) external onlyGovernance {
        require(_twapDuration != 0, "RT0");
        twapDuration = _twapDuration;
    }

    ///@notice set address of usd value token
    ///@param _usdValueAddress the address of new usd value token
    function setUsdValueTokenAddress(address _usdValueAddress) external onlyGovernance {
        require(_usdValueAddress != address(0), "RUA");
        usdValueTokenAddress = _usdValueAddress;
    }

    ///@notice set address of weth9
    ///@param _weth9 the address of new weth9
    function setWETH9(address _weth9) external onlyGovernance {
        require(_weth9 != address(0), "RWA");
        weth9 = _weth9;
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
    }

    ///@notice deactivates a fee tier
    ///@param fee fee tier to be deactivated
    function deactivateFeeTier(uint24 fee) external onlyGovernance {
        require(allowableFeeTiers[fee], "DRAFT");
        allowableFeeTiers[fee] = false;
        for (uint256 i; i < feeTiers.length; ++i) {
            if (feeTiers[i] == fee) {
                if (feeTiers.length == 1) {
                    feeTiers.pop();
                    break;
                }
                feeTiers[i] = feeTiers[feeTiers.length - 1];
                feeTiers.pop();
                break;
            }
        }
    }

    ///@notice get service fee ratio for a given license amount
    ///@param _licenseAmount license amount to get service fee ratio
    function getServiceFeeRatioFromLicenseAmount(uint32 _licenseAmount) external view override returns (uint32 ratio) {
        require(_licenseAmount != 0, "RLA0");
        if (_licenseAmount < serviceFeeRatioLength) {
            return licnesesToServiceFeeRatio[_licenseAmount];
        } else {
            return licnesesToServiceFeeRatio[serviceFeeRatioLength];
        }
    }
}
