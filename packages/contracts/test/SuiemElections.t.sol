// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {SuiemElections, IBurnableERC20} from "../src/SuiemElections.sol";

/// @dev Burnable mock with the same burn semantics as $WIF (OZ ERC20Burnable).
contract MockWIF is ERC20Burnable {
    constructor() ERC20("Mock WIF", "WIF") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev A token whose `burnFrom` only moves tokens to a dead address: supply does not fall.
contract FakeBurnToken is ERC20 {
    constructor() ERC20("Fake", "FAKE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burnFrom(address account, uint256 amount) external {
        _spendAllowance(account, msg.sender, amount);
        _transfer(account, address(0xdEaD), amount);
    }
}

contract SixDecimals is ERC20 {
    constructor() ERC20("Six", "SIX") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

abstract contract ElectionsBase is Test {
    SuiemElections el;
    MockWIF wif;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint64 constant T0 = 1_800_000_000;
    uint64 constant START = T0 + 100;
    uint64 constant END = T0 + 3_700;

    function setUp() public virtual {
        vm.chainId(4663);
        vm.warp(T0);
        wif = new MockWIF();
        el = new SuiemElections(owner, IBurnableERC20(address(wif)));
        wif.mint(alice, 1_000e18);
        wif.mint(bob, 1_000e18);
    }

    function create(uint64 cap, uint8 n) internal returns (uint256 id) {
        vm.prank(owner);
        id = el.createElection(START, END, cap, n);
    }

    function voteAs(address who, uint256 id, uint256 cand, uint256 n) internal {
        vm.startPrank(who);
        wif.approve(address(el), n * 1e18);
        el.vote(id, cand, n);
        vm.stopPrank();
    }
}

contract ElectionsUnitTest is ElectionsBase {
    // ---- construction ------------------------------------------------------------------------
    function test_constructor_rejects_bad_token() public {
        vm.expectRevert(SuiemElections.ZeroAddress.selector);
        new SuiemElections(owner, IBurnableERC20(address(0)));
        SixDecimals six = new SixDecimals();
        vm.expectRevert(SuiemElections.BadDecimals.selector);
        new SuiemElections(owner, IBurnableERC20(address(six)));
    }

    function test_holds_no_eth() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(el).call{value: 1}("");
        assertFalse(ok);
        assertEq(address(el).balance, 0);
    }

    // ---- create / admin ----------------------------------------------------------------------
    function test_create_emits_and_stores() public {
        vm.expectEmit(true, false, false, true, address(el));
        emit SuiemElections.ElectionCreated(1, START, END, 25, 3);
        uint256 id = create(25, 3);
        assertEq(id, 1);
        SuiemElections.Election memory e = el.getElection(1);
        assertEq(e.startTime, START);
        assertEq(e.endTime, END);
        assertEq(e.capPerWallet, 25);
        assertEq(e.candidateCount, 3);
        assertEq(uint8(e.status), uint8(SuiemElections.Status.Scheduled));
        assertEq(uint8(el.phase(1)), uint8(SuiemElections.Phase.Scheduled));
        assertEq(el.tallies(1).length, 3);
    }

    function test_create_validation() public {
        vm.startPrank(owner);
        vm.expectRevert(SuiemElections.BadWindow.selector);
        el.createElection(T0, END, 25, 2); // start not in the future
        vm.expectRevert(SuiemElections.BadWindow.selector);
        el.createElection(START, START, 25, 2);
        vm.expectRevert(SuiemElections.BadCap.selector);
        el.createElection(START, END, 0, 2);
        vm.expectRevert(SuiemElections.BadCandidateCount.selector);
        el.createElection(START, END, 25, 0);
        vm.expectRevert(SuiemElections.BadCandidateCount.selector);
        el.createElection(START, END, 25, 9);
        el.createElection(START, END, 25, 8);
        vm.stopPrank();
    }

    function test_only_owner_can_create_add_cancel() public {
        create(25, 2);
        bytes memory err = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice);
        vm.startPrank(alice);
        vm.expectRevert(err);
        el.createElection(START, END, 25, 2);
        vm.expectRevert(err);
        el.addCandidates(1, 1);
        vm.expectRevert(err);
        el.cancel(1);
        vm.stopPrank();
    }

    function test_add_candidates_before_start_only() public {
        create(25, 2);
        vm.expectEmit(true, false, false, true, address(el));
        emit SuiemElections.CandidatesAdded(1, 5);
        vm.prank(owner);
        el.addCandidates(1, 3);
        assertEq(el.getElection(1).candidateCount, 5);
        vm.prank(owner);
        vm.expectRevert(SuiemElections.BadCandidateCount.selector);
        el.addCandidates(1, 4); // 9 > 8
        vm.warp(START);
        vm.prank(owner);
        vm.expectRevert(SuiemElections.AlreadyStarted.selector);
        el.addCandidates(1, 1);
    }

    function test_cancel_before_start_only() public {
        create(25, 2);
        create(25, 2);
        vm.expectEmit(true, false, false, true, address(el));
        emit SuiemElections.ElectionCancelled(1);
        vm.prank(owner);
        el.cancel(1);
        assertEq(uint8(el.phase(1)), uint8(SuiemElections.Phase.Cancelled));
        vm.prank(owner);
        vm.expectRevert(SuiemElections.NotScheduled.selector);
        el.cancel(1);
        vm.warp(START);
        vm.prank(owner);
        vm.expectRevert(SuiemElections.AlreadyStarted.selector);
        el.cancel(2);
    }

    function test_two_step_ownership() public {
        address next = makeAddr("next");
        vm.prank(owner);
        el.transferOwnership(next);
        assertEq(el.owner(), owner); // not yet
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        el.acceptOwnership();
        vm.prank(next);
        el.acceptOwnership();
        assertEq(el.owner(), next);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        el.createElection(START, END, 25, 2);
    }

    function test_unknown_election() public {
        vm.expectRevert(SuiemElections.UnknownElection.selector);
        el.phase(1);
        vm.expectRevert(SuiemElections.UnknownElection.selector);
        el.vote(1, 1, 1);
        vm.expectRevert(SuiemElections.UnknownElection.selector);
        el.finalize(1);
    }

    // ---- voting window -----------------------------------------------------------------------
    function test_window_edges() public {
        create(25, 2);
        vm.warp(START - 1);
        vm.startPrank(alice);
        wif.approve(address(el), 10e18);
        vm.expectRevert(SuiemElections.NotOpen.selector);
        el.vote(1, 1, 1);
        vm.warp(START); // first open second
        el.vote(1, 1, 1);
        vm.warp(END - 1); // last open second
        el.vote(1, 1, 1);
        vm.warp(END); // closed
        vm.expectRevert(SuiemElections.NotOpen.selector);
        el.vote(1, 1, 1);
        vm.stopPrank();
        assertEq(el.votes(1, 1), 2);
        assertEq(uint8(el.phase(1)), uint8(SuiemElections.Phase.Closed));
    }

    function test_vote_burns_and_emits() public {
        create(25, 3);
        vm.warp(START);
        uint256 supply = wif.totalSupply();
        vm.startPrank(alice);
        wif.approve(address(el), 7e18);
        vm.expectEmit(true, true, true, true, address(el));
        emit SuiemElections.VoteCast(1, 2, alice, 7);
        vm.expectEmit(true, true, true, true, address(el));
        emit SuiemElections.VoteAssetBurned(1, 2, alice, 7e18);
        el.vote(1, 2, 7);
        vm.stopPrank();
        assertEq(wif.totalSupply(), supply - 7e18);
        assertEq(wif.balanceOf(alice), 993e18);
        assertEq(wif.balanceOf(address(el)), 0);
        assertEq(wif.allowance(alice, address(el)), 0);
        assertEq(el.votes(1, 2), 7);
        assertEq(el.votedBy(1, alice), 7);
        assertEq(el.getElection(1).totalVotes, 7);
        assertEq(el.remainingCap(1, alice), 18);
        assertEq(uint8(el.phase(1)), uint8(SuiemElections.Phase.Open));
    }

    function test_cap_per_wallet() public {
        create(25, 2);
        vm.warp(START);
        voteAs(alice, 1, 1, 20);
        vm.startPrank(alice);
        wif.approve(address(el), 6e18);
        vm.expectRevert(abi.encodeWithSelector(SuiemElections.CapExceeded.selector, 5));
        el.vote(1, 2, 6); // cap is across candidates
        el.vote(1, 2, 5);
        vm.expectRevert(abi.encodeWithSelector(SuiemElections.CapExceeded.selector, 0));
        el.vote(1, 2, 1);
        vm.stopPrank();
        voteAs(bob, 1, 1, 25); // other wallets have their own cap
        assertEq(el.remainingCap(1, alice), 0);
    }

    function test_whole_tokens_only() public {
        create(25, 2);
        vm.warp(START);
        vm.startPrank(alice);
        wif.approve(address(el), 1e18 - 1); // an allowance short of one whole token can't vote
        vm.expectRevert();
        el.vote(1, 1, 1);
        vm.expectRevert(SuiemElections.ZeroVotes.selector);
        el.vote(1, 1, 0);
        vm.stopPrank();
        assertEq(el.TOKEN_PER_VOTE(), 1e18);
    }

    function test_unknown_candidate() public {
        create(25, 2);
        vm.warp(START);
        vm.startPrank(alice);
        wif.approve(address(el), 1e18);
        vm.expectRevert(SuiemElections.UnknownCandidate.selector);
        el.vote(1, 0, 1);
        vm.expectRevert(SuiemElections.UnknownCandidate.selector);
        el.vote(1, 3, 1);
        vm.stopPrank();
    }

    function test_insufficient_allowance_or_balance() public {
        create(25, 2);
        vm.warp(START);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(el), 0, 1e18)
        );
        el.vote(1, 1, 1);
        address poor = makeAddr("poor");
        vm.startPrank(poor);
        wif.approve(address(el), 1e18);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, poor, 0, 1e18));
        el.vote(1, 1, 1);
        vm.stopPrank();
    }

    function test_cancelled_election_rejects_votes() public {
        create(25, 2);
        vm.prank(owner);
        el.cancel(1);
        vm.warp(START);
        vm.startPrank(alice);
        wif.approve(address(el), 1e18);
        vm.expectRevert(SuiemElections.NotOpen.selector);
        el.vote(1, 1, 1);
        vm.stopPrank();
        vm.warp(END);
        vm.expectRevert(SuiemElections.NotScheduled.selector);
        el.finalize(1);
    }

    // ---- finalize ----------------------------------------------------------------------------
    function test_finalize_timing_and_once() public {
        create(25, 2);
        vm.warp(START);
        voteAs(alice, 1, 1, 3);
        voteAs(bob, 1, 2, 4);
        vm.warp(END - 1);
        vm.expectRevert(SuiemElections.NotEnded.selector);
        el.finalize(1);
        vm.warp(END);
        vm.expectEmit(true, false, false, true, address(el));
        emit SuiemElections.ElectionFinalized(1, 7);
        vm.prank(bob); // anyone
        el.finalize(1);
        assertEq(uint8(el.phase(1)), uint8(SuiemElections.Phase.Finalized));
        vm.expectRevert(SuiemElections.NotScheduled.selector);
        el.finalize(1);
        uint256[] memory t = el.tallies(1);
        assertEq(t[0], 3);
        assertEq(t[1], 4);
    }

    // ---- "burned" means supply dropped -------------------------------------------------------
    function test_vote_reverts_when_supply_does_not_fall() public {
        FakeBurnToken fake = new FakeBurnToken();
        SuiemElections el2 = new SuiemElections(owner, IBurnableERC20(address(fake)));
        fake.mint(alice, 10e18);
        vm.prank(owner);
        el2.createElection(START, END, 25, 2);
        vm.warp(START);
        vm.startPrank(alice);
        fake.approve(address(el2), 1e18);
        vm.expectRevert(SuiemElections.BurnNotEffective.selector);
        el2.vote(1, 1, 1);
        vm.stopPrank();
        assertEq(fake.balanceOf(alice), 10e18);
    }

    // ---- fuzz --------------------------------------------------------------------------------
    function testFuzz_cap_never_exceeded(uint64 cap, uint256[6] calldata amounts, uint8 who) public {
        cap = uint64(bound(cap, 1, 50));
        create(cap, 3);
        vm.warp(START);
        address voter = address(uint160(uint256(keccak256(abi.encode(who))) | 1));
        wif.mint(voter, 1_000e18);
        uint256 burned;
        for (uint256 i = 0; i < amounts.length; i++) {
            uint256 n = bound(amounts[i], 0, 60);
            vm.startPrank(voter);
            wif.approve(address(el), n * 1e18);
            try el.vote(1, (i % 3) + 1, n) {
                burned += n * 1e18;
            } catch {}
            vm.stopPrank();
            assertLe(el.votedBy(1, voter), cap);
        }
        assertEq(1_000e18 - wif.balanceOf(voter), burned);
        assertEq(el.getElection(1).totalVotes * 1e18, burned);
    }
}

/// @dev Random voters/amounts/candidates/timestamps against two elections.
contract ElectionsHandler is Test {
    SuiemElections public el;
    MockWIF public wif;
    address[] public voters;
    uint256 public burned;
    uint256 public immutable supply0;

    constructor(SuiemElections el_, MockWIF wif_) {
        el = el_;
        wif = wif_;
        for (uint256 i = 0; i < 5; i++) {
            address v = address(uint160(0x1000 + i));
            voters.push(v);
            wif_.mint(v, 500e18);
        }
        supply0 = wif_.totalSupply();
    }

    function vote(uint256 v, uint256 id, uint256 cand, uint256 n) external {
        address voter = voters[bound(v, 0, voters.length - 1)];
        id = bound(id, 1, 2);
        cand = bound(cand, 0, 4);
        n = bound(n, 0, 30);
        vm.startPrank(voter);
        wif.approve(address(el), n * 1e18);
        try el.vote(id, cand, n) {
            burned += n * 1e18;
        } catch {}
        wif.approve(address(el), 0);
        vm.stopPrank();
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 600));
    }

    function finalize(uint256 id) external {
        try el.finalize(bound(id, 1, 2)) {} catch {}
    }

    function sendEth(uint256 amt) external {
        vm.deal(address(this), amt);
        (bool ok,) = address(el).call{value: bound(amt, 0, 1 ether)}("");
        ok;
    }
}

contract ElectionsInvariantTest is StdInvariant, ElectionsBase {
    ElectionsHandler h;

    function setUp() public override {
        super.setUp();
        vm.startPrank(owner);
        el.createElection(START, END, 25, 3);
        el.createElection(START, END, 10, 4);
        vm.stopPrank();
        h = new ElectionsHandler(el, wif);
        targetContract(address(h));
    }

    function invariant_holds_no_funds() public view {
        assertEq(wif.balanceOf(address(el)), 0);
        assertEq(address(el).balance, 0);
    }

    function invariant_tallies_sum_to_total_and_burned() public view {
        uint256 all;
        for (uint256 id = 1; id <= 2; id++) {
            uint256[] memory t = el.tallies(id);
            uint256 sum;
            for (uint256 i = 0; i < t.length; i++) {
                sum += t[i];
            }
            assertEq(sum, el.getElection(id).totalVotes);
            all += sum;
        }
        assertEq(all * 1e18, h.burned());
        assertEq(h.supply0() - wif.totalSupply(), h.burned());
    }

    function invariant_cap_respected() public view {
        for (uint256 i = 0; i < 5; i++) {
            address v = h.voters(i);
            assertLe(el.votedBy(1, v), 25);
            assertLe(el.votedBy(2, v), 10);
        }
    }
}
