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
    },
    polygon: {
      url: process.env.ALCHEMY_POLYGON_MAINNET || "",
      accounts: [process.env.TEST_PRIVATE_KEY || ""],
    },
    optimismGoerli: {
      url: process.env.ALCHEMY_OPTIMISM_GOERLI || "",
      accounts: [process.env.TEST_PRIVATE_KEY || ""],
    },
    optimism: {
      url: process.env.ALCHEMY_OPTIMISM_MAINNET || "",
      accounts: [process.env.TEST_PRIVATE_KEY || ""],
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
      default: 0,
    },
    multiSig: {
      default: 0,
    },
    official: {
      default: "0xedFA23616e1B11eb4649940Ce20A79BD1aFcf43e",
    },
    keeper: {
      default: "0xcafCE5363A2dEC41e0597B6B3c6c1A11ab219698",
    },
  },
};

export default config;
