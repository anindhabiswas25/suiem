// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SuiemElections, IBurnableERC20} from "../../src/SuiemElections.sol";

/// @notice Fork tests against the REAL $WIF on Robinhood Chain mainnet 4663 at a pinned block.
/// @dev    Needs `MAINNET_RPC_URL` (a secret: the PO's QuickNode endpoint). Without it every test is
///         skipped with a visible message, which is what CI does. Run locally:
///         `pnpm contracts:test:fork` (reads .env). Nothing here sends a real transaction.
contract SuiemElectionsForkTest is Test {
    /// Pinned mainnet block (2026-11-11). The PO wallet held 128.29 $WIF here.
    uint256 constant FORK_BLOCK = 111_685_000;
    address constant WIF_ADDR = 0x5173b8eA6923c2d40267890D45C46a3480954773;
    /// PO test voter wallet (public address; we only impersonate it on the local fork).
    address constant HOLDER = 0xc7b6D8350DaAf397B83B2a66dd69a76804a79A37;

    IBurnableERC20 wif = IBurnableERC20(WIF_ADDR);
    SuiemElections el;
    address owner = makeAddr("owner");
    uint64 start;
    uint64 end;

    function setUp() public {
        string memory url = vm.envOr("MAINNET_RPC_URL", string(""));
        if (bytes(url).length == 0) {
            console.log("SKIPPED: fork tests need MAINNET_RPC_URL (secret; not available in CI)");
            vm.skip(true);
            return;
        }
        vm.createSelectFork(url, FORK_BLOCK);
        assertEq(block.chainid, 4663, "fork is not Robinhood Chain mainnet");
        el = new SuiemElections(owner, wif);
        start = uint64(block.timestamp + 60);
        end = start + 3600;
        vm.prank(owner);
        el.createElection(start, end, 25, 3);
        vm.warp(start);
    }

    function test_fork_token_identity() public view {
        assertEq(IERC20Metadata(WIF_ADDR).decimals(), 18);
        assertEq(IERC20Metadata(WIF_ADDR).symbol(), "WIF");
        assertEq(IERC20Metadata(WIF_ADDR).name(), "World is Flat");
        assertGt(IERC20Metadata(WIF_ADDR).balanceOf(HOLDER), 25e18);
    }

    function test_fork_vote_burns_real_wif() public {
        IERC20Metadata t = IERC20Metadata(WIF_ADDR);
        uint256 supply0 = t.totalSupply();
        uint256 bal0 = t.balanceOf(HOLDER);
        vm.startPrank(HOLDER);
        t.approve(address(el), 3e18);
        vm.expectEmit(true, true, true, true, address(el));
        emit SuiemElections.VoteCast(1, 2, HOLDER, 3);
        vm.expectEmit(true, true, true, true, address(el));
        emit SuiemElections.VoteAssetBurned(1, 2, HOLDER, 3e18);
        el.vote(1, 2, 3);
        vm.stopPrank();
        // "Burned" is only true because supply really fell by exactly the amount.
        assertEq(supply0 - t.totalSupply(), 3e18, "totalSupply must drop by exactly the amount");
        assertEq(bal0 - t.balanceOf(HOLDER), 3e18);
        assertEq(t.balanceOf(address(el)), 0);
        assertEq(address(el).balance, 0);
        assertEq(t.allowance(HOLDER, address(el)), 0);
        assertEq(el.votes(1, 2), 3);
        console.log("fork: supply before", supply0);
        console.log("fork: supply after ", t.totalSupply());
    }

    function test_fork_cap_on_real_token() public {
        IERC20Metadata t = IERC20Metadata(WIF_ADDR);
        vm.startPrank(HOLDER);
        t.approve(address(el), 26e18);
        vm.expectRevert(abi.encodeWithSelector(SuiemElections.CapExceeded.selector, 25));
        el.vote(1, 1, 26);
        el.vote(1, 1, 25);
        vm.expectRevert(abi.encodeWithSelector(SuiemElections.CapExceeded.selector, 0));
        el.vote(1, 1, 1);
        vm.stopPrank();
    }

    function test_fork_vote_after_end_reverts() public {
        vm.warp(end);
        vm.startPrank(HOLDER);
        IERC20Metadata(WIF_ADDR).approve(address(el), 1e18);
        vm.expectRevert(SuiemElections.NotOpen.selector);
        el.vote(1, 1, 1);
        vm.stopPrank();
        el.finalize(1);
        assertEq(uint8(el.phase(1)), uint8(SuiemElections.Phase.Finalized));
    }
}
