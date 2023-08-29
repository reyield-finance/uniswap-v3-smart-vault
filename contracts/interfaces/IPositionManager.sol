// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface IPositionManager {
    struct PositionInfo {
        uint256 tokenId;
        address strategyProvider;
        bytes16 strategyId;
        uint256 totalDepositUSDValue;
        uint256 amount0CollectedFee;
        uint256 amount1CollectedFee;
        uint256 amount0Leftover;
        uint256 amount1Leftover;
        int24 tickLowerDiff;
        int24 tickUpperDiff;
        uint256 amount0Returned;
        uint256 amount1Returned;
        uint256 amount0ReturnedUsdValue;
        uint256 amount1ReturnedUsdValue;
    }

    ///@notice create position
    ///@param tokenId ID of the position
    ///@param strategyProvider The address of the strategy provider
    ///@param strategyId The ID of the strategy
    ///@param totalDepositUSDValue The total deposit value in USD
    ///@param tickLowerDiff difference between the current tick of the position and the provied lower tick
    ///@param tickUpperDiff difference between the current tick of the position and the provied upper tick
    ///@param amount0Leftover The amount of token0 leftover after rebalance
    ///@param amount1Leftover The amount of token1 leftover after rebalance
    struct CreatePositionInput {
        uint256 tokenId;
        address strategyProvider;
        bytes16 strategyId;
        uint256 totalDepositUSDValue;
        int24 tickLowerDiff;
        int24 tickUpperDiff;
        uint256 amount0Leftover;
        uint256 amount1Leftover;
    }

    ///@notice create position
    ///@param inputs CreatePositionInput struct
    ///@return positionId ID of the position
    function createPosition(CreatePositionInput calldata inputs) external returns (uint256 positionId);

    ///@notice update position total deposit USD value
    ///@param positionId ID of the position
    ///@param _totalDepositUSDValue The total deposit value in USD
    ///@param _amount0Leftover The amount of token0 leftover after increasing liquidity
    ///@param _amount1Leftover The amount of token1 leftover after increasing liquidity
    function middlewareIncreaseLiquidity(
        uint256 positionId,
        uint256 _totalDepositUSDValue,
        uint256 _amount0Leftover,
        uint256 _amount1Leftover
    ) external;

    ///@notice get position info from tokenId
    ///@param tokenId ID of the position
    ///@return positionInfo PositionInfo struct
    function getPositionInfoFromTokenId(uint256 tokenId) external view returns (PositionInfo memory positionInfo);

    ///@notice get position info from positionId
    ///@param positionId ID of the position
    ///@return positionInfo PositionInfo struct
    function getPositionInfo(uint256 positionId) external view returns (PositionInfo memory positionInfo);

    ///@notice check if the position is running
    ///@param positionId ID of the position
    ///@return bool true if the position is running
    function isPositionRunning(uint256 positionId) external view returns (bool);

    ///@notice middleware function to update position info for rebalance
    ///@param positionId ID of the position
    ///@param newTokenId ID of the new NFT
    ///@param tickLowerDiff The difference between the current tick and the tickLower
    ///@param tickUpperDiff The difference between the current tick and the tickUpper
    ///@param amount0CollectedFee The amount of token0 collected fee after rebalance
    ///@param amount1CollectedFee The amount of token1 collected fee after rebalance
    ///@param amount0Leftover The amount of token0 leftover after rebalance
    ///@param amount1Leftover The amount of token1 leftover after rebalance
    function middlewareRebalance(
        uint256 positionId,
        uint256 newTokenId,
        int24 tickLowerDiff,
        int24 tickUpperDiff,
        uint256 amount0CollectedFee,
        uint256 amount1CollectedFee,
        uint256 amount0Leftover,
        uint256 amount1Leftover
    ) external;

    ///@notice struct for middleware withdraw
    ///@param positionId ID of the position
    ///@param amount0CollectedFee The amount of token0 collected fee after withdrwan
    ///@param amount1CollectedFee The amount of token1 collected fee after withdrwan
    ///@param amount0Returned The amount of token0 returned after withdrwan
    ///@param amount1Returned The amount of token1 returned after withdrwan
    ///@param amount0ReturnedUsdValue The amount of token0 returned in USD after withdrwan
    ///@param amount1ReturnedUsdValue The amount of token1 returned in USD after withdrwan
    struct MiddlewareWithdrawInput {
        uint256 positionId;
        uint256 amount0CollectedFee;
        uint256 amount1CollectedFee;
        uint256 amount0Returned;
        uint256 amount1Returned;
        uint256 amount0ReturnedUsdValue;
        uint256 amount1ReturnedUsdValue;
    }

    ///@notice middleware function to update position info for withdraw
    ///@param input MiddlewareWithdrawInput struct
    function middlewareWithdraw(MiddlewareWithdrawInput memory input) external;

    function setModuleData(uint256 positionId, address moduleAddress, bytes32 data) external;

    function getPositionModuleData(uint256 _positionId, address _moduleAddress) external view returns (bytes32 data);

    ///@notice get position lower tick diff and upper tick diff
    ///@param positionId ID of the position
    ///@return tickLowerDiff difference between the current tick of the position and the provied lower tick
    ///@return tickUpperDiff difference between the current tick of the position and the provied upper tick
    function getPositionTickDiffs(uint256 positionId) external view returns (int24, int24);

    function getOwner() external view returns (address);
}
