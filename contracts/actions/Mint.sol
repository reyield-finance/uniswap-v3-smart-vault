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
import "../interfaces/IPositionManager.sol";
import "../interfaces/actions/IMint.sol";

///@notice action to mint a UniswapV3 position NFT
contract Mint is IMint {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    ///@notice mints a UniswapV3 position NFT
    ///@param inputs struct of MintInput parameters
    ///@return tokenId ID of the minted NFT
    ///@return amount0Deposited token0 amount deposited
    ///@return amount1Deposited token1 amount deposited
    function mint(
        MintInput calldata inputs
    ) external override returns (uint256 tokenId, uint256 amount0Deposited, uint256 amount1Deposited) {
        StorageStruct storage Storage = PositionManagerStorage.getStorage();

        address nonfungiblePositionManagerAddress = Storage.uniswapAddressHolder.nonfungiblePositionManagerAddress();

        ERC20Helper.approveToken(inputs.token0Address, nonfungiblePositionManagerAddress, inputs.amount0Desired);
        ERC20Helper.approveToken(inputs.token1Address, nonfungiblePositionManagerAddress, inputs.amount1Desired);

        (tokenId, , amount0Deposited, amount1Deposited) = INonfungiblePositionManager(nonfungiblePositionManagerAddress)
            .mint(
                INonfungiblePositionManager.MintParams({
                    token0: inputs.token0Address,
                    token1: inputs.token1Address,
                    fee: inputs.fee,
                    tickLower: inputs.tickLower,
                    tickUpper: inputs.tickUpper,
                    amount0Desired: inputs.amount0Desired,
                    amount1Desired: inputs.amount1Desired,
                    amount0Min: 0,
                    amount1Min: 0,
                    recipient: address(this),
                    deadline: block.timestamp
                })
            );

        uint256 amount0Leftover = inputs.amount0Desired.sub(amount0Deposited);
        uint256 amount1Leftover = inputs.amount1Desired.sub(amount1Deposited);
        ///@dev send leftover tokens back to the user if necessary
        if (inputs.isReturnLeftOver) {
            if (amount0Leftover != 0) IERC20(inputs.token0Address).safeTransfer(Storage.owner, amount0Leftover);
            if (amount1Leftover != 0) IERC20(inputs.token1Address).safeTransfer(Storage.owner, amount1Leftover);
        }

        emit PositionMinted(
            address(this),
            tokenId,
            amount0Deposited,
            amount1Deposited,
            amount0Leftover,
            amount1Leftover
        );
    }
}
