import { HardhatRuntimeEnvironment } from "hardhat/types";

export const START_TIME = Date.now();

interface Pool {
  token0: string;
  token1: string;
  fee: number;
}

interface NetworkConfig {
  sleep: number;
  gasPrice: string;
  gasLimit: string;
  governance?: string;
  serviceFeeRecipient?: string;
  officialAccount?: string;
  keeper?: string;
  usdcAddress: string;
  wethAddress: string;
  nonfungiblePositionManager: string;
  uniswapV3Factory: string;
  swapRouter: string;
  pools?: Pool[];
}

interface DeployConfig {
  [chainId: string]: NetworkConfig;
}

export const Config: DeployConfig = {
  "10": {
    sleep: 20000,
    gasLimit: "10000000",
    gasPrice: "8000000",
    usdcAddress: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
    wethAddress: "0x4200000000000000000000000000000000000006",
    nonfungiblePositionManager: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    uniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    swapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
  },
  "137": {
    sleep: 25000,
    gasLimit: "10000000",
    gasPrice: "120000000000",
    usdcAddress: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    wethAddress: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    nonfungiblePositionManager: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    uniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    swapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
  },
  "80001": {
    sleep: 5000,
    gasLimit: "10000000",
    gasPrice: "1520000000",
    usdcAddress: "0xe6b8a5CF854791412c1f6EFC7CAf629f5Df1c747",
    wethAddress: "0x9c3C9283D3e44854697Cd22D3Faa240Cfb032889",
    nonfungiblePositionManager: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    uniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    swapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
  },
  "420": {
    sleep: 25000,
    gasLimit: "10000000",
    gasPrice: "1000000000",
    usdcAddress: "0xB33A5c53d7039C2fb8eE49be83070115E2ee50Fb",
    wethAddress: "0x4200000000000000000000000000000000000006",
    nonfungiblePositionManager: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    uniswapV3Factory: "0x174468500B2c210e36e45ad754108D5dD497f73D",
    swapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    pools: [
      {
        token0: "0xB33A5c53d7039C2fb8eE49be83070115E2ee50Fb",
        token1: "0x4200000000000000000000000000000000000006",
        fee: 500,
      },
    ],
  },
};

const func = async function (hre: HardhatRuntimeEnvironment) {
  const { network, getChainId, getNamedAccounts } = hre;

  const chainId = await getChainId();

  if (!network?.live) Config[chainId].sleep = 0;

  const { governance, serviceFeeRecipient, official, keeper } = await getNamedAccounts();
  console.log("official: ", official);

  if (governance === undefined || serviceFeeRecipient === undefined || official === undefined || keeper === undefined) {
    throw new Error("Named accounts not configured for this network");
  }

  Config[chainId].governance = governance;
  Config[chainId].serviceFeeRecipient = serviceFeeRecipient;
  Config[chainId].officialAccount = official;
  Config[chainId].keeper = keeper;

  console.log("governance: ", Config[chainId].governance);
  console.log("serviceFeeRecipient: ", Config[chainId].serviceFeeRecipient);
  console.log("official: ", Config[chainId].officialAccount);
  console.log("keeper: ", Config[chainId].keeper);

  console.log(`:: Initialized sleep timeout: ${Config[chainId].sleep}ms`);
  console.log(`:: Initialized gas price: ${Config[chainId].gasPrice} wei`);
  console.log(`:: Initialized gas limit: ${Config[chainId].gasLimit} wei`);
};

export default func;
func.tags = ["SmartVault", "Config"];
