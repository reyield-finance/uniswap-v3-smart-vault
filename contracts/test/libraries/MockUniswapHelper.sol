// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "../../libraries/UniswapHelper.sol";

contract MockUniswapHelper {
    ///@notice contract to interact with NFT helper for testing

    ///@notice get the pool address
    ///@param factory address of the UniswapV3Factory
    ///@param token0 address of the token0
    ///@param token1 address of the token1
    ///@param fee fee tier of the pool
    ///@return address address of the pool
    function getPool(address factory, address token0, address token1, uint24 fee) public view returns (address) {
        return UniswapHelper.getPool(factory, token0, token1, fee);
    }

    ///@notice get the address of the tpkens from the tokenId
    ///@param tokenId id of the position (NFT)
    ///@param nonfungiblePositionManager instance of the nonfungiblePositionManager given by the caller (address)
    ///@return token0address address of the token0
    ///@return token1address address of the token1
    ///@return fee fee tier of the pool
    ///@return tickLower of position
    ///@return tickUpper of position
    function getTokens(
        uint256 tokenId,
        INonfungiblePositionManager nonfungiblePositionManager
    ) public view returns (address token0address, address token1address, uint24 fee, int24 tickLower, int24 tickUpper) {
        UniswapHelper.getTokensOutput memory output = UniswapHelper.getTokens(tokenId, nonfungiblePositionManager);
        token0address = output.token0;
        token1address = output.token1;
        fee = output.fee;
        tickLower = output.tickLower;
        tickUpper = output.tickUpper;
    }

    ///@notice Reorder tokens to be in the correct order for the pool
    ///@param _token0 address of token0
    ///@param _token1 address of token1
    ///@return token0 address of token0 after reordering
    ///@return token1 address of token1 after reordering
    ///@return isOrderChanged bool if the order was changed
    function reorderTokens(
        address _token0,
        address _token1
    ) public pure returns (address token0, address token1, bool isOrderChanged) {
        return UniswapHelper.reorderTokens(_token0, _token1);
    }

    ///@notice Calculates the liquidity and amounts for a given position
    ///@param factory address of the UniswapV3Factory
    ///@param token0 address of the token0
    ///@param token1 address of the token1
    ///@param fee fee tier of the pool
    ///@param tickLower the lower bound of position
    ///@param tickUpper the upper bound of position
    ///@param amount0Desired amount of token0
    ///@param amount1Desired amount of token1
    function calLiquidityAndAmounts(
        address factory,
        address token0,
        address token1,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper,
        uint256 amount0Desired,
        uint256 amount1Desired
    ) public view returns (uint128 liquidity, uint256 amount0, uint256 amount1) {
        return
            UniswapHelper.calLiquidityAndAmounts(
                factory,
                token0,
                token1,
                fee,
                tickLower,
                tickUpper,
                amount0Desired,
                amount1Desired
            );
    }

    function findV3DeepestPool(
        address factoryAddress,
        address token0,
        address token1,
        uint24[] memory feeTiers
    ) public view returns (address deepestPool) {
        return UniswapHelper.findV3DeepestPool(factoryAddress, token0, token1, feeTiers);
    }

    function isPoolExist(
        address factoryAddress,
        address token0,
        address token1,
        uint24[] memory feeTiers
    ) public view returns (bool) {
        return UniswapHelper.isPoolExist(factoryAddress, token0, token1, feeTiers);
    }

    function getCurrentTick(
        address factoryAddress,
        address token0,
        address token1,
        uint24 fee
    ) public view returns (int24 currentTick) {
        return UniswapHelper.getCurrentTick(factoryAddress, token0, token1, fee);
    }

    function adjustDepositTick(
        address factoryAddress,
        int24 currentTick,
        uint24 fee
    ) external view returns (int24 currentTickAdjusted) {
        return UniswapHelper.adjustDepositTick(factoryAddress, currentTick, fee);
    }
}
