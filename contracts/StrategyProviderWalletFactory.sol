// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "./StrategyProviderWallet.sol";
import "./interfaces/IRegistry.sol";
import "./interfaces/IStrategyProviderWalletFactory.sol";
import "./interfaces/IUniswapAddressHolder.sol";
import "./interfaces/IRegistryAddressHolder.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract StrategyProviderWalletFactory is IStrategyProviderWalletFactory {
    using SafeMath for uint256;

    address public immutable registryAddressHolder;
    address public immutable uniswapAddressHolder;

    mapping(address => address) public override providerToWallet;
    mapping(address => bool) public isIncreatorWhitelist;
    address[] public strategyProviderWallets;

    address[] public creatorWhitelist;

    ///@notice emitted when a new strategy provider wallet is created
    ///@param strategyProviderWallet address of StrategyProviderWallet
    ///@param provider address of provider
    event StrategyProviderWalletCreated(address indexed strategyProviderWallet, address creator, address provider);

    ///@notice emitted when a creator is added to whitelist
    ///@param creator address of creator
    event CreatorWhitelistAdded(address indexed creator);

    modifier onlyGovernance() {
        require(msg.sender == registry().governance(), "SPWFOG");
        _;
    }

    modifier onlycreator() {
        require(isIncreatorWhitelist[msg.sender], "SPWOCWL");
        _;
    }

    constructor(address _registryAddressHolder, address _uniswapAddressHolder) {
        require(_registryAddressHolder != address(0), "SPWFRAH0");
        require(_uniswapAddressHolder != address(0), "SPWFUAH0");
        registryAddressHolder = _registryAddressHolder;
        uniswapAddressHolder = _uniswapAddressHolder;
    }

    ///@notice get IRegistry from registryAddressHolder
    ///@return IRegistry interface of registry
    function registry() private view returns (IRegistry) {
        return IRegistry(IRegistryAddressHolder(registryAddressHolder).registry());
    }

    ///@notice add creator to whitelist
    ///@param _creator address of creator
    function addCreatorWhitelist(address _creator) external onlyGovernance {
        require(_creator != address(0), "SPWFA0");
        require(!isIncreatorWhitelist[_creator], "SPWFNICWL");
        isIncreatorWhitelist[_creator] = true;
        creatorWhitelist.push(_creator);
        emit CreatorWhitelistAdded(_creator);
    }

    ///@notice create the strategy provider wallet
    ///@param provider address of provider
    function create(address provider) external override onlycreator returns (address walletAddress) {
        require(providerToWallet[provider] == address(0), "SPWFA0");
        StrategyProviderWallet wallet = new StrategyProviderWallet(
            provider,
            registryAddressHolder,
            uniswapAddressHolder
        );
        strategyProviderWallets.push(address(wallet));
        providerToWallet[provider] = address(wallet);

        emit StrategyProviderWalletCreated(address(wallet), address(msg.sender), provider);

        return address(wallet);
    }

    ///@notice get the array of strategy provider wallet addresses
    ///@param cursor is the aforementioned cursor. It simply indicates the starting index for enumeration. The first call should pass 0, and subsequent calls should pass the returned newCursor.
    ///@param howMany indicates how many items should be returned. If there aren’t enough remaining items in the array, the function will return fewer items.
    ///@return wallets address[] return array of StrategyProviderWallet addresses
    ///@return newCursor uint256 return the new cursor
    function getStrategyProviderWallets(
        uint256 cursor,
        uint256 howMany
    ) public view returns (address[] memory wallets, uint256 newCursor) {
        uint256 length = howMany;
        if (length > strategyProviderWallets.length - cursor) {
            length = strategyProviderWallets.length - cursor;
        }

        wallets = new address[](length);
        for (uint256 i = 0; i < length; i++) {
            wallets[i] = strategyProviderWallets[cursor + i];
        }

        return (wallets, cursor + length);
    }

    ///@notice get the length of the strategy provider wallet array
    ///@return uint256 length of the strategy provider wallet array
    function getStrategyProviderWalletsLength() external view returns (uint256) {
        return strategyProviderWallets.length;
    }
}
