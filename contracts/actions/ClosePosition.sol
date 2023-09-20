// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "../Storage.sol";
import "../interfaces/IPositionManager.sol";
import "../interfaces/actions/IClosePosition.sol";

contract ClosePosition is IClosePosition {
    ///@notice close a UniswapV3 position NFT
    ///@param tokenId id of the token to close
    ///@param returnTokenToUser true if the token should be returned to the user
    ///@return amount0CollectedFee uint256 amount of token0 collected fee
    ///@return amount1CollectedFee uint256 amount of token1 collected fee
    ///@return amount0Removed uint256 amount of token0 removed from liquidity
    ///@return amount1Removed uint256 amount of token1 removed from liquidity
    function closePosition(
        uint256 tokenId,
        bool returnTokenToUser
    )
        external
        override
        returns (
            uint256 amount0CollectedFee,
            uint256 amount1CollectedFee,
            uint256 amount0Removed,
            uint256 amount1Removed
        )
    {
        StorageStruct storage Storage = PositionManagerStorage.getStorage();

        INonfungiblePositionManager nonfungiblePositionManager = INonfungiblePositionManager(
            Storage.uniswapAddressHolder.nonfungiblePositionManagerAddress()
        );

        ///@dev collect first time to get the earned fees
        INonfungiblePositionManager.CollectParams memory firstCollectparams = INonfungiblePositionManager
            .CollectParams({
                tokenId: tokenId,
                recipient: returnTokenToUser ? Storage.owner : address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            });
        (amount0CollectedFee, amount1CollectedFee) = nonfungiblePositionManager.collect(firstCollectparams);

        ///@dev decrease liquidity
        (, , , , , , , uint128 liquidity, , , , ) = nonfungiblePositionManager.positions(tokenId);
        if (liquidity != 0) {
            INonfungiblePositionManager.DecreaseLiquidityParams
                memory decreaseliquidityparams = INonfungiblePositionManager.DecreaseLiquidityParams({
                    tokenId: tokenId,
                    liquidity: liquidity,
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: block.timestamp
                });
            nonfungiblePositionManager.decreaseLiquidity(decreaseliquidityparams);
        }

        ///@dev collect second time to get the liquidity removed
        INonfungiblePositionManager.CollectParams memory secondCollectparams = INonfungiblePositionManager
            .CollectParams({
                tokenId: tokenId,
                recipient: returnTokenToUser ? Storage.owner : address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            });
        (amount0Removed, amount1Removed) = nonfungiblePositionManager.collect(secondCollectparams);

        emit PositionClosed(
            address(this),
            tokenId,
            amount0CollectedFee,
            amount1CollectedFee,
            amount0Removed,
            amount1Removed
        );
    }
}
