import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";
import "hardhat-deploy";
import { HardhatUserConfig } from "hardhat/config";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.7.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
            details: {
              yul: true,
            },
          },
        },
      },
      // for mocking weth9
      {
        version: "0.4.22",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
            details: {
              yul: true,
            },
          },
        },
      },
    ],
  },
  typechain: {
    outDir: "types",
    target: "ethers-v5",
  },

  gasReporter: {
    enabled: false,
    currency: "USD",
    gasPrice: 35,
  },
  networks: {
    hardhat: {
      forking: {
        enabled: true,
        url: process.env.ALCHEMY_OPTIMISM_MAINNET || "",
        blockNumber: 107735215,
      },
      mining: { auto: true },
    },
    mumbai: {
      url: process.env.ALCHEMY_POLYGON_MUMBAI || "",
      accounts: [process.env.TEST_PRIVATE_KEY || ""],
      // gas: 10000000,
      // gasPrice: 1520000000,
    },
    polygon: {
      url: process.env.ALCHEMY_POLYGON_MAINNET || "",
      accounts: [process.env.TEST_PRIVATE_KEY || ""],
      gas: 10000000,
      gasPrice: 128000000000,
    },
    optimismGoerli: {
      url: process.env.ALCHEMY_OPTIMISM_GOERLI || "",
      accounts: [process.env.TEST_PRIVATE_KEY || ""],
      gas: 10000000,
      gasPrice: 1000000000,
    },
    optimism: {
      url: process.env.ALCHEMY_OPTIMISM_MAINNET || "",
      accounts: [process.env.TEST_PRIVATE_KEY || ""],
      // gas: 10000000,
      // gasPrice: 8000000,
    },
  },
  etherscan: {
    apiKey: {
      mumbai: process.env.POLYGONSCAN_API_KEY || "",
      polygon: process.env.POLYGONSCAN_API_KEY || "",
      optimismGoerli: process.env.OPTIMISM_ETHERSCAN_API_KEY || "",
      optimism: process.env.OPTIMISM_ETHERSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "mumbai",
        chainId: 80001,
        urls: {
          apiURL: "https://api-testnet.polygonscan.com/api",
          browserURL: "https://mumbai.polygonscan.com",
        },
      },
      {
        network: "polygon",
        chainId: 137,
        urls: {
          apiURL: "https://api.polygonscan.com/api",
          browserURL: "https://polygonscan.com",
        },
      },
      {
        network: "optimismGoerli",
        chainId: 420,
        urls: {
          apiURL: "https://api-goerli-optimism.etherscan.io/api",
          browserURL: "https://goerli-optimism.etherscan.io",
        },
      },
      {
        network: "optimism",
        chainId: 10,
        urls: {
          apiURL: "https://api-optimistic.etherscan.io/api",
          browserURL: "https://optimistic.etherscan.io",
        },
      },
    ],
  },
  mocha: {
    timeout: 20000000000,
    parallel: false,
  },
  namedAccounts: {
    deployer: {
      default: "0x565d490806A6D8eF532f4d29eC00EF6aAC71A17A",
    },
    governance: {
      default: "0x565d490806A6D8eF532f4d29eC00EF6aAC71A17A",
    },
    serviceFeeRecipient: {
      default: "0x63d89F8A05691d7D1f816293443C5c74Ef79aC73",
    },
    official: {
      default: "0xF769DFf3D3715a9773e00a9B0d62Dc754699b7CA",
    },
    keeper: {
      default: "0x10cd85932c9e782b1d57fb3c4071a93b0224976b",
    },
  },
};

export default config;
