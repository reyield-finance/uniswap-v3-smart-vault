// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface IPositionManager {
    enum PositionStatus {
        Initial,
        Running,
        Closed
    }
    // Initial=0, Running=1, Closed=2
    struct PositionInfo {
        uint256 tokenId;
        address strategyProvider;
        bytes16 strategyId;
        uint256 amount0Deposited;
        uint256 amount1Deposited;
        uint256 amount0DepositedUsdValue;
        uint256 amount1DepositedUsdValue;
        uint256 amount0CollectedFee;
        uint256 amount1CollectedFee;
        uint256 amount0Leftover;
        uint256 amount1Leftover;
        int24 tickLowerDiff;
        int24 tickUpperDiff;
    }

    struct PositionSettlement {
        uint256 amount0Returned;
        uint256 amount1Returned;
        uint256 amount0ReturnedUsdValue;
        uint256 amount1ReturnedUsdValue;
    }

    ///@notice get position id counter
    ///@return uint256 position id counter
    function positionIdCounter() external view returns (uint256);

    ///@notice get position status
    ///@param positionId ID of the position
    ///@return PositionStatus position status
    function positionStatus(uint256 positionId) external view returns (PositionStatus);

    ///@notice get position settlement
    ///@param positionId ID of the position
    ///@return positionSettlementInfo PositionSettlement struct
    function getPositionSettlement(
        uint256 positionId
    ) external view returns (PositionSettlement memory positionSettlementInfo);

    ///@notice create position
    ///@param tokenId ID of the position
    ///@param strategyProvider The address of the strategy provider
    ///@param strategyId The ID of the strategy
    ///@param amount0Deposited The amount of token0 deposited
    ///@param amount1Deposited The amount of token1 deposited
    ///@param amount0DepositedUsdValue The amount of token0 deposited in USD
    ///@param amount1DepositedUsdValue The amount of token1 deposited in USD
    ///@param tickLowerDiff difference between the current tick of the position and the provied lower tick
    ///@param tickUpperDiff difference between the current tick of the position and the provied upper tick
    ///@param amount0Leftover The amount of token0 leftover after rebalance
    ///@param amount1Leftover The amount of token1 leftover after rebalance
    struct CreatePositionInput {
        uint256 tokenId;
        address strategyProvider;
        bytes16 strategyId;
        uint256 amount0Deposited;
        uint256 amount1Deposited;
        uint256 amount0DepositedUsdValue;
        uint256 amount1DepositedUsdValue;
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
    ///@param amount0Deposited The amount of token0 deposited
    ///@param amount1Deposited The amount of token1 deposited
    ///@param amount0DepositedUsdValue The amount of token0 deposited in USD
    ///@param amount1DepositedUsdValue The amount of token1 deposited in USD
    ///@param amount0Leftover The amount of token0 leftover after increasing liquidity
    ///@param amount1Leftover The amount of token1 leftover after increasing liquidity
    function middlewareIncreaseLiquidity(
        uint256 positionId,
        uint256 amount0Deposited,
        uint256 amount1Deposited,
        uint256 amount0DepositedUsdValue,
        uint256 amount1DepositedUsdValue,
        uint256 amount0Leftover,
        uint256 amount1Leftover
    ) external;

    ///@notice get positionId from tokenId
    ///@param tokenId ID of the position
    ///@return positionId ID of the position
    function getPositionIdFromTokenId(uint256 tokenId) external view returns (uint256);

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

    function getOwner() external view returns (address);
}
