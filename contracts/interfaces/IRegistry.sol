// SPDX-License-Identifier: GPL-2.0
pragma solidity 0.7.6;
pragma abicoder v2;

interface IRegistry {
    ///@notice emitted when governance address is changed
    ///@param oldGovernance the old governance address
    ///@param newGovernance the new governance address
    event GovernanceChanged(address oldGovernance, address newGovernance);

    ///@notice emitted when service fee recipient address is changed
    ///@param oldServiceFeeRecipient the old service fee recipient address
    ///@param newServiceFeeRecipient the new service fee recipient address
    event ServiceFeeRecipientChanged(address oldServiceFeeRecipient, address newServiceFeeRecipient);

    ///@notice emitted when position manager factory address is changed
    ///@param oldPositionManagerFactory the old position manager factory address
    ///@param newPositionManagerFactory the new position manager factory address
    event PositionManagerFactoryChanged(address oldPositionManagerFactory, address newPositionManagerFactory);

    ///@notice emitted when strategy provider wallet factory address is changed
    ///@param oldStrategyProviderWalletFactory the old strategy provider wallet factory address
    ///@param newStrategyProviderWalletFactory the new strategy provider wallet factory address
    event StrategyProviderWalletFactoryChanged(
        address oldStrategyProviderWalletFactory,
        address newStrategyProviderWalletFactory
    );

    ///@notice emitted when official account address is changed
    ///@param newOfficialAccount the new official account address
    event OfficialAccountChanged(address oldOfficialAccount, address newOfficialAccount);

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

    ///@notice emitted when a keeper is added to whitelist
    ///@param keeper address of the added keeper
    event KeeperAdded(address keeper);

    ///@notice emitted when a keeper is removed from whitelist
    ///@param keeper address of the removed keeper
    event KeeperRemoved(address keeper);

    ///@notice emitted when a fee tier is activated
    ///@param feeTier fee tier activated
    event FeeTierActivated(uint24 feeTier);

    ///@notice emitted when a fee tier is deactivated
    ///@param feeTier fee tier deactivated
    event FeeTierDeactivated(uint24 feeTier);

    ///@notice emitted when service fee ratio is updated
    ///@param licenseAmount license amount to update service fee ratio
    ///@param serviceFeeRatio service fee ratio to update
    event ServiceFeeRatioUpdated(uint32 licenseAmount, uint32 serviceFeeRatio);

    ///@notice emitted when usd value token address is updated
    ///@param oldUsdValueTokenAddress the old usd value token address
    ///@param newUsdValueTokenAddress the new usd value token address
    event UsdValueTokenAddressUpdated(address oldUsdValueTokenAddress, address newUsdValueTokenAddress);

    ///@notice emitted when weth9 address is updated
    ///@param oldWeth9 the old weth9 address
    ///@param newWeth9 the new weth9 address
    event Weth9Updated(address oldWeth9, address newWeth9);

    ///@notice emitted when max twap deviation is updated
    ///@param oldMaxTwapDeviation the old twap deviation
    ///@param newMaxTwapDeviation the new twap deviation
    event MaxTwapDeviationUpdated(int24 oldMaxTwapDeviation, int24 newMaxTwapDeviation);

    ///@notice emitted when twap duration is updated
    ///@param oldTwapDuration the old twap duration
    ///@param newTwapDuration the new twap duration
    event TwapDurationUpdated(uint32 oldTwapDuration, uint32 newTwapDuration);

    ///@notice emitted when module data is updated
    ///@param id keccak256 of module id string
    ///@param contractAddress address of the module
    ///@param defaultData default data of the module
    event ModuleDataUpdated(bytes32 id, address contractAddress, bytes32 defaultData);

    struct Entry {
        bytes32 id;
        address contractAddress;
        bytes32 defaultData;
    }

    ///@notice check if the fee tier is allowable
    ///@param feeTier the fee tier to check
    ///@return true if the fee tier is allowable, false otherwise
    function isAllowableFeeTier(uint24 feeTier) external view returns (bool);

    ///@notice get the list of fee tiers
    ///@return array of fee tiers
    function getFeeTiers() external view returns (uint24[] memory);

    ///@notice get the list of allowable fee tiers
    ///@return array of allowable fee tiers
    function getAllowableFeeTiers() external view returns (uint24[] memory);

    ///@notice return the address of PositionManagerFactory
    ///@return address of PositionManagerFactory
    function positionManagerFactoryAddress() external view returns (address);

    ///@notice return the address of StrategyProviderWalletFactory
    ///@return address of StrategyProviderWalletFactory
    function strategyProviderWalletFactoryAddress() external view returns (address);

    ///@notice return the address of officialAccount
    ///@return address of officialAccount
    function officialAccount() external view returns (address);

    ///@notice return the address of weth9
    ///@return address of weth9
    function weth9() external view returns (address);

    ///@notice return the address of Governance
    ///@return address of Governance
    function governance() external view returns (address);

    ///@notice return the address of recipient of service fee
    ///@return address of recipient of service fee
    function serviceFeeRecipient() external view returns (address);

    ///@notice return the max twap deviation
    ///@return int24 max twap deviation
    function maxTwapDeviation() external view returns (int24);

    ///@notice return the twap duration
    ///@return uint32 twap duration
    function twapDuration() external view returns (uint32);

    ///@notice return the address of USD value token
    ///@return address of USD value token
    function usdValueTokenAddress() external view returns (address);

    ///@notice return the denominator of service fee ratio
    ///@return uint32 denominator of service fee ratio
    function serviceFeeDenominator() external view returns (uint32);

    ///@notice return the address of Governance
    ///@return address of Governance
    function getModuleKeys() external view returns (bytes32[] memory);

    ///@notice checks if the address is whitelisted as a keeper
    ///@param _keeper address to check
    ///@return bool true if the address is withelisted, false otherwise
    function whitelistedKeepers(address _keeper) external view returns (bool);

    ///@notice get the module info by id
    ///@param _id id of the module
    ///@return Entry module info
    function getModuleInfo(bytes32 _id) external view returns (Entry memory);

    ///@notice check if the module is active
    ///@param _contractAddress address of the module
    ///@return bool true if the module is active, false otherwise
    function activeModule(address _contractAddress) external view returns (bool);

    ///@notice get service fee ratio for a given license amount
    ///@param _licenseAmount license amount to get service fee ratio
    function getServiceFeeRatioFromLicenseAmount(uint32 _licenseAmount) external view returns (uint32 ratio);
}
