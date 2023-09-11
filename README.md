# Uniswap V3 Smart Vault

# Table of contents
- [Flowchart](#flowchart)
- [Project Folder Architecture](#project-folder-architecture)
- [Quick Start](#quick-start)
    - [Setting](#setting)
    - [Commands](#commands)

## Flowchart

<img src="./doc/uniswap-v3-smart-vault-flowchart.drawio.png" alt="flowchart" width="700" height="700">

## Project Folder Architecture

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