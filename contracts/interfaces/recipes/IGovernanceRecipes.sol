// SPDX-License-Identifier: GPL-2.0

pragma solidity 0.7.6;
pragma abicoder v2;

interface IGovernanceRecipes {
    ///@notice emitted when a position is created
    ///@param positionManager the address of the position manager which recieved the position
    ///@param from address of the user
    ///@param positionId ID of the position
    ///@param tokenId ID of the minted NFT
    event PositionWithdrawan(address indexed positionManager, address from, uint256 positionId, uint256 tokenId);
}
