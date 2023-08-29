// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "../libraries/ERC20Helper.sol";
import "../libraries/UniswapHelper.sol";
import "../Storage.sol";
import "../interfaces/actions/IIncreaseLiquidity.sol";

///@notice action to increase the liquidity of a V3 position
contract IncreaseLiquidity is IIncreaseLiquidity {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    ///@notice increase the liquidity of a UniswapV3 position
    ///@param inputs struct of IncreaseLiquidityInput parameters
    ///@return amount0Increased the increased amount of token0
    ///@return amount1Increased the increased amount of token1
    function increaseLiquidity(
        IncreaseLiquidityInput calldata inputs
    ) external override returns (uint256 amount0Increased, uint256 amount1Increased) {
        StorageStruct storage Storage = PositionManagerStorage.getStorage();

        address nonfungiblePositionManagerAddress = Storage.uniswapAddressHolder.nonfungiblePositionManagerAddress();

        ERC20Helper._approveToken(inputs.token0Address, nonfungiblePositionManagerAddress, inputs.amount0Desired);
        ERC20Helper._approveToken(inputs.token1Address, nonfungiblePositionManagerAddress, inputs.amount1Desired);

        INonfungiblePositionManager.IncreaseLiquidityParams memory params = INonfungiblePositionManager
            .IncreaseLiquidityParams({
                tokenId: inputs.tokenId,
                amount0Desired: inputs.amount0Desired,
                amount1Desired: inputs.amount1Desired,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp
            });
        (, amount0Increased, amount1Increased) = INonfungiblePositionManager(nonfungiblePositionManagerAddress)
            .increaseLiquidity(params);

        uint256 amount0Leftover = inputs.amount0Desired.sub(amount0Increased);
        uint256 amount1Leftover = inputs.amount1Desired.sub(amount1Increased);

        ///@dev send leftover tokens back to the user if necessary
        if (amount0Leftover != 0) IERC20(inputs.token0Address).safeTransfer(Storage.owner, amount0Leftover);
        if (amount1Leftover != 0) IERC20(inputs.token1Address).safeTransfer(Storage.owner, amount1Leftover);

        emit LiquidityIncreased(address(this), inputs.tokenId, amount0Increased, amount1Increased);
    }
}
