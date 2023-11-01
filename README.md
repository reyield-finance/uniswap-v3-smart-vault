# Uniswap V3 Smart Vault

# Table of contents
- [Flowchart](#flowchart)
- [Project Folder Architecture](#project-folder-architecture)
- [Quick Start](#quick-start)
    - [Setting](#setting)
    - [Commands](#commands)
- [Deployment Addresses](#deployment-addresses)

# Flowchart

<img src="./doc/uniswap-v3-smart-vault-flowchart.drawio.png" alt="flowchart" width="700" height="700">

# Project Folder Architecture

---

    |-- Project
        |-- contracts   --this is where the source files for your contracts should be.
            |-- actions
                |-- ClosePosition.sol
                |-- IncreaseLiquidity.sol
                |-- Mint.sol
                |-- RepayRebalanceFee.sol
                |-- ReturnProfit.sol
                |-- ShareProfit.sol
                |-- SingleTokenIncreaseLiquidity.sol
                |-- SwapToPositionRatio.sol
                |-- ZapIn.sol
            |-- libraries
                |-- ERC20Helper.sol
                |-- MathHelper.sol
                |-- SafeInt24Math.sol
                |-- SafeInt56Math.sol
                |-- SafeUint32Math.sol
                |-- SwapHelper.sol
                |-- UniswapHelper.sol
            |-- modules
                |-- BaseModule.sol
                |-- IdleLiquidityModule.sol
            |-- recipes
                |-- BaseRecipes.sol
                |-- DepositRecipes.sol
                |-- WithdrawRecipes.sol
                |-- GovernanceRecipes.sol
            |-- interfaces
                |-- actions
                    |-- IClosePosition.sol
                    |-- IIncreaseLiquidity.sol
                    |-- IMint.sol
                    |-- IRepayRebalanceFee.sol
                    |-- IReturnProfit.sol
                    |-- IShareProfit.sol
                    |-- ISingleTokenIncreaseLiquidity.sol
                    |-- ISwapToPositionRatio.sol
                    |-- IZapIn.sol
                |-- modules
                    |-- IIdleLiquidityModule.sol
                |-- recipes
                    |-- IDepositRecipes.sol
                    |-- IWithdrawRecipes.sol
                |-- IDiamondCut.sol
                |-- IERC20Extended.sol
                |-- IPositionManager.sol
                |-- IPositionManagerFactory.sol
                |-- IRegistry.sol
                |-- IScaledBalanceToken.sol
                |-- IUniswapAddressHolder.sol
                |-- IUniswapCalculator.sol
                |-- IStrategyProviderWallet.sol
                |-- IStrategyProviderWalletFactory.sol
                |-- IMulticall.sol
                |-- IWETH9.sol
            |-- base
                |-- Multicall.sol
            |-- test
                ...
            |-- utils
                |-- UniswapAddressHolder.sol
                |-- UniswapCalculator.sol
                |-- PositionHelper.sol
                |-- ERC20Extended.sol
            |-- Storage.sol
            |-- DiamondCutFacet.sol
            |-- PositionManager.sol
            |-- PositionManagerFactory.sol
            |-- StrategyProviderWallet.sol
            |-- StrategyProviderWalletFactory.sol
            |-- Registry.sol
            |-- Timelock.sol
        |-- deploy
            ... 
        |-- test --this is where your tests should go.
        |-- scripts --this is where simple automation scripts go.

---

# Quick Start

## Setting

* .env
```
ALCHEMY_POLYGON_MAINNET = "https://polygon-mainnet.g.alchemy.com/v2/{{KEY}}"
ALCHEMY_POLYGON_MUMBAI = "https://polygon-mumbai.g.alchemy.com/v2/{{KEY}}"
ALCHEMY_OPTIMISM_MAINNET = "https://opt-mainnet.g.alchemy.com/v2/{{KEY}}"
ALCHEMY_OPTIMISM_GOERLI = "https://opt-goerli.g.alchemy.com/v2/{{KEY}}"
TEST_PRIVATE_KEY = "{{PRIVATE_KEY}}" #with 0x prefix
OPTIMISM_ETHERSCAN_API_KEY = "{{OPTIMISM_ETHERSCAN_API_KEY}}"
POLYGONSCAN_API_KEY = "{{POLYGONSCAN_API_KEY}}"
```

* hardhat.config.ts
```
  namedAccounts: {
    deployer: {
      default: "{{DEPLOYER_ADDRESS}}",
    },
    governance: {
      default: "{{GOVERNANCE_ADDRESS}}",
    },
    serviceFeeRecipient: {
      default: "{{SERVICE_FEE_RECIPIENT_ADDRESS}}",
    },
    official: {
      default: "{{OFFICIAL_ADDRESS}}",
    },
    keeper: {
      default: "{{KEEPER_ADDRESS}}",
    },
  },
```

| Name | Description |
| ---- | ----------- |
| deployer | Address of account for deploy. |
| governance | Address of governance which is responsible for setting all official configuration including setting the address of factory address, adding new contracts to proxy ...etc. |
| serviceFeeRecipient | Address of recipient of service fee. The service fee will be charged when the user position closed. |
| official | Address of official account which provided the official strategies. |
| keeper | Address of keeper which is used to trigger the function of auto-rebalancing and auto-management function. |


## Commands
* install modules
```
$ yarn install
```

* compile contracts
```
$ yarn compile
```

* run test
```
$ yarn test
```

* run test with coverage report
```
$ yarn coverage
```

* deploy Smart Vault contracts
```
$ yarn deploy:{{chain}} --tags SmartVault
```

* run scripts
```
$ yarn deploy:{{chain}} scripts/{{FIlE_NAME}}
```

* clean all caches
```
$ yarn clean
```

# Deployment Addresses

| Contract                  | Optimism, Polygon Address                                     |
|---------------------------|---------------------------------------------|
| Registry                  | `0x621e848F39fb29843cf8b42c86Ff2558bCd6C327`  |
| DiamondCutFacet           | `0x8AfaC6A9C1643746DBE980E9f318e85c14cAdD9B`  |
| RegistryAddressHolder     | `0xe5b481AFFFbfe1A61d762f42d4c630a5AAD388f9`  |
| UniswapAddressHolder      | `0x162Ff164B376fB1Fb0Ed657467123b262F25a985`  |
| PositionManagerFactory    | `0x3332Ae0fC25eF24352ca75c01A1fCfd9fc33EAca`  |
| StrategyProviderWalletFactory | `0x8984A6a7d64B8D5558FFc5A93cF536f631C77d4F`  |
| ClosePosition             | `0xE46ABe3f8b1Bc205dc24F431b025b73cd5FCA710`  |
| IncreaseLiquidity         | `0xEFD5B5953DaD2bDf5abe5128345038Fda941f46d`  |
| Mint                      | `0xB45F87f2381ED5993BD08C9C0d806c55F39e5b10`  |
| RepayRebalanceFee         | `0x3A4980cc52C11F6C4e89b9661D92223C14a1e975`  |
| ReturnProfit              | `0xe5930CE185b70a034FC34d2DDC57bE125D36e0Cb`  |
| ShareProfit               | `0xa43A376627cFA2f9Ada588d77997a46756dB4571`  |
| SingleTokenIncreaseLiquidity | `0x92De2ec547eE8B763b139283263A9facB1C92e06`  |
| SwapToPositionRatio       | `0x9204ccE7E9FC1525472A4FACB74dEF6c3370D898`  |
| ZapIn                     | `0x9524503FD59F716271c43A99Be747d35E5c31140`  |
| IdleLiquidityModule       | `0x928E7b3F3980f0008AcB44c074AaA8C00FAd0aF3`  |
| DepositRecipes            | `0x32D939ca3351cC85054964fcbAc95af167996696`  |
| IncreaseLiquidityRecipes  | `0x53112264b98D466062F36EB3f92EE5DE44821AAe`  |
| WithdrawRecipes           | `0xF5CCEEa954bD2fa37d383650E0730Ce947c60B3C`  |
| GovernanceRecipes         | `0x5652A51dA73873F1Bf5615C0fA5EaB77fc2e4510`  |
| PositionHelper            | `0x76136A56963740b4992C5E9dA5bB58ECffC92ce3`  |
| UniswapCalculator         | `0x0eE1Deb6e6ccAcCb157324c98A247Cc6440b335F`  |
| ERC20Extended             | `0x86Ae132100eC35156A524911584069C34E68F9e2`  |
| Timelock                  | `0x9c0fBE88001ae2daCd7Dc28b920C16F99fE880b9`  |