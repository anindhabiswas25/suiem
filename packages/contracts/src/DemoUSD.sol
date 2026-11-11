// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Suiem Demo USD (testnet, no value)
/// @notice 6-decimal demo dollar for the Suiem testnet venue. Anyone can claim 1,000 dUSD once per
///         24 hours. The venue (fixed at deployment) is the only other minter. No admin mint.
contract DemoUSD is ERC20 {
    uint256 public constant CLAIM_AMOUNT = 1_000 * 1e6;
    uint256 public constant CLAIM_COOLDOWN = 24 hours;

    address public immutable venue;
    mapping(address => uint256) public lastClaimAt;

    event Claimed(address indexed account, uint256 amount);

    error ClaimCooldown(uint256 availableAt);
    error OnlyVenue();
    error ZeroAddress();

    constructor(address venue_) ERC20("Suiem Demo USD (testnet, no value)", "dUSD") {
        if (venue_ == address(0)) revert ZeroAddress();
        venue = venue_;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Claim 1,000 dUSD. Uses block.timestamp (block.number is unreliable on Arbitrum chains).
    function claim() external {
        uint256 last = lastClaimAt[msg.sender];
        if (last != 0 && block.timestamp < last + CLAIM_COOLDOWN) revert ClaimCooldown(last + CLAIM_COOLDOWN);
        lastClaimAt[msg.sender] = block.timestamp;
        _mint(msg.sender, CLAIM_AMOUNT);
        emit Claimed(msg.sender, CLAIM_AMOUNT);
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != venue) revert OnlyVenue();
        _mint(to, amount);
    }

    /// @notice The venue burns dUSD it received for a buy (only its own balance).
    function burn(uint256 amount) external {
        if (msg.sender != venue) revert OnlyVenue();
        _burn(msg.sender, amount);
    }
}
