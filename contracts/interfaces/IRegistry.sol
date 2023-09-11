// SPDX-License-Identifier: GPL-2.0
pragma solidity 0.7.6;
pragma abicoder v2;

interface IRegistry {
    struct Entry {
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

    ///@notice get service fee ratio for a given license amount
    ///@param _licenseAmount license amount to get service fee ratio
    function getServiceFeeRatioFromLicenseAmount(uint32 _licenseAmount) external view returns (uint32 ratio);
}
