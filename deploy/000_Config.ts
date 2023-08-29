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
  usdcAddress: string;
  wethAddress: string;
  uniswapV3Factory: string;
  pools?: Pool[];
}

interface DeployConfig {
  [chainId: string]: NetworkConfig;
}

export const Config: DeployConfig = {
  "80001": {
    sleep: 25000,
    gasLimit: "10000000",
    gasPrice: "1520000000",
    usdcAddress: "0xe6b8a5CF854791412c1f6EFC7CAf629f5Df1c747",
    wethAddress: "0x9c3C9283D3e44854697Cd22D3Faa240Cfb032889",
    uniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  },
  "420": {
    sleep: 25000,
    gasLimit: "10000000",
    gasPrice: "1000000000",
    usdcAddress: "0xB33A5c53d7039C2fb8eE49be83070115E2ee50Fb",
    wethAddress: "0x4200000000000000000000000000000000000006",
    uniswapV3Factory: "0x174468500B2c210e36e45ad754108D5dD497f73D",
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
  const { network, getChainId } = hre;

  const chainId = await getChainId();

  if (!network?.live) Config[chainId].sleep = 0;

  console.log(`:: Initialized sleep timeout: ${Config[chainId].sleep}ms`);
  console.log(`:: Initialized gas price: ${Config[chainId].gasPrice} wei`);
  console.log(`:: Initialized gas limit: ${Config[chainId].gasLimit} wei`);
};

export default func;
func.tags = ["SmartVault", "Config"];
