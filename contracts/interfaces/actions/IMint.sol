// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface IMint {
    ///@notice emitted when a UniswapNFT is deposited in PositionManager
    ///@param positionManager address of PositionManager
    ///@param tokenId Id of deposited token
    ///@param amount0Deposited token0 amount deposited
    ///@param amount1Deposited token1 amount deposited
    ///@param amount0Leftover token0 amount leftover
    ///@param amount1Leftover token1 amount leftover
    event PositionMinted(
        address indexed positionManager,
        uint256 tokenId,
        uint256 amount0Deposited,
        uint256 amount1Deposited,
        uint256 amount0Leftover,
        uint256 amount1Leftover
    );

    ///@notice struct for input of the mint action
    ///@param token0Address address of the first token
    ///@param token1Address address of the second token
    ///@param fee pool fee level
    ///@param tickLower lower tick of the position
    ///@param tickUpper upper tick of the position
    ///@param amount0Desired amount of first token in position
    ///@param amount1Desired amount of second token in position
    ///@param isReturnLeftOver if true, return left over tokens to owner of position
    struct MintInput {
        address token0Address;
        address token1Address;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        bool isReturnLeftOver;
    }

    function mint(
        MintInput calldata inputs
    ) external returns (uint256 tokenId, uint256 amount0Deposited, uint256 amount1Deposited);
}
