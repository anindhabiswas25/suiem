// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Suiem demo stock token (testnet, no value)
/// @notice NOT a share, NOT a security, NOT a Stock Token. A no-value practice token for the Suiem
///         testnet demo. Only the venue (fixed at deployment) can mint and burn.
contract DemoStockToken is ERC20 {
    address public immutable venue;
    /// @notice Underlying ticker this demo token tracks for pricing only (e.g. "TSLA").
    string public ticker;

    error OnlyVenue();
    error ZeroAddress();

    constructor(string memory ticker_, address venue_)
        ERC20(string.concat("Suiem Demo ", ticker_, " (testnet, no value)"), string.concat("d", ticker_))
    {
        if (venue_ == address(0)) revert ZeroAddress();
        venue = venue_;
        ticker = ticker_;
    }

    modifier onlyVenue() {
        if (msg.sender != venue) revert OnlyVenue();
        _;
    }

    function mint(address to, uint256 amount) external onlyVenue {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyVenue {
        _burn(from, amount);
    }
}
