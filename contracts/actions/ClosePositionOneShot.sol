// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "../Storage.sol";
import "../interfaces/IPositionManager.sol";
import "../interfaces/actions/IClosePositionOneShot.sol";

contract ClosePositionOneShot is IClosePositionOneShot {
    ///@notice close position in one shot
    ///@param input struct of closePositionOneShot parameters
    ///@return output struct of closePositionOneShot return values
    function closePositionOneShot(
        ClosePositionOneShotInput memory input
    ) external override returns (ClosePositionOneShotOutput memory output) {
        StorageStruct storage Storage = PositionManagerStorage.getStorage();

        INonfungiblePositionManager nonfungiblePositionManager = INonfungiblePositionManager(
            Storage.uniswapAddressHolder.nonfungiblePositionManagerAddress()
        );

        ///@dev decrease liquidity
        (, , , , , , , uint128 liquidity, , , , ) = nonfungiblePositionManager.positions(input.tokenId);
        if (liquidity != 0) {
            INonfungiblePositionManager.DecreaseLiquidityParams
                memory decreaseliquidityparams = INonfungiblePositionManager.DecreaseLiquidityParams({
                    tokenId: input.tokenId,
                    liquidity: liquidity,
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline: block.timestamp
                });
            nonfungiblePositionManager.decreaseLiquidity(decreaseliquidityparams);
        }

        ///@dev collect
        INonfungiblePositionManager.CollectParams memory secondCollectparams = INonfungiblePositionManager
            .CollectParams({
                tokenId: input.tokenId,
                recipient: input.returnTokenToUser ? Storage.owner : address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            });
        (output.amount0Collected, output.amount1Collected) = nonfungiblePositionManager.collect(secondCollectparams);

        emit PositionClosed(address(this), input.tokenId, output.amount0Collected, output.amount1Collected);
    }
}
