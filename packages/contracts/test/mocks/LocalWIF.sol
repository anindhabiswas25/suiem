// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @dev LOCAL TESTS ONLY. Installed with `anvil_setCode` at the real $WIF address on a local
///      chain-4663 anvil so the API/indexer integration tests exercise the hard-coded address and the
///      identity check. Name and symbol are constants because setCode leaves storage empty.
contract LocalWIF is ERC20Burnable {
    constructor() ERC20("", "") {}

    function name() public pure override returns (string memory) {
        return "World is Flat";
    }

    function symbol() public pure override returns (string memory) {
        return "WIF";
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
