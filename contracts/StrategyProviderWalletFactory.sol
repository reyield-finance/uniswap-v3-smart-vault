// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "./StrategyProviderWallet.sol";
import "./interfaces/IRegistry.sol";
import "./interfaces/IStrategyProviderWalletFactory.sol";
import "./interfaces/IUniswapAddressHolder.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract StrategyProviderWalletFactory is IStrategyProviderWalletFactory {
    using SafeMath for uint256;

    address public immutable registry;
    address public immutable uniswapAddressHolder;

    mapping(address => address) public override providerToWallet;
    //XXX: isInCreateorWhitelist?
    mapping(address => bool) public isIncreatorWhitelist;
    address[] public strategyProviderWallets;

    address[] public creatorWhitelist;

    ///@notice emitted when a new strategy provider wallet is created
    ///@param strategyProviderWallet address of StrategyProviderWallet
    ///@param provider address of provider
    event StrategyProviderWalletCreated(address indexed strategyProviderWallet, address creator, address provider);

    modifier onlyGovernance() {
        require(msg.sender == IRegistry(registry).governance(), "SPWFOG");
        _;
    }

    modifier onlycreator() {
        require(isIncreatorWhitelist[msg.sender], "SPWOCWL");
        _;
    }

    constructor(address _registry, address _uniswapAddressHolder) {
        registry = _registry;
        uniswapAddressHolder = _uniswapAddressHolder;
    }

    //XXX: is it able to remove creator from creatorWhitelist? what's the drawback? Who would be add to the list?
    function addCreatorWhitelist(address _creator) external onlyGovernance {
        require(_creator != address(0), "SPWFA0");
        require(!isIncreatorWhitelist[_creator], "SPWFNICWL");
        isIncreatorWhitelist[_creator] = true;
        creatorWhitelist.push(_creator);
    }

    function create(address provider) external override onlycreator returns (address walletAddress) {
        require(providerToWallet[provider] == address(0), "SPWFA0");
        StrategyProviderWallet wallet = new StrategyProviderWallet(provider, registry, uniswapAddressHolder);
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
