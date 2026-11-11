// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {DemoStockToken} from "../src/DemoStockToken.sol";
import {DemoUSD} from "../src/DemoUSD.sol";
import {SuiemDemoVenue} from "../src/SuiemDemoVenue.sol";

contract VenueTest is Test {
    SuiemDemoVenue venue;
    DemoUSD dusd;
    DemoStockToken tsla;
    uint256 signerPk = 0xA11CE;
    address signer;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint256 nextNonce = 1;

    function setUp() public {
        vm.chainId(46630);
        vm.warp(1_800_000_000);
        signer = vm.addr(signerPk);
        venue = new SuiemDemoVenue(owner, signer);
        dusd = new DemoUSD(address(venue));
        tsla = new DemoStockToken("TSLA", address(venue));
        vm.startPrank(owner);
        venue.setDemoUSD(dusd);
        venue.setListed(address(tsla), true);
        vm.stopPrank();
        vm.prank(alice);
        dusd.claim();
    }

    function quote(address trader, SuiemDemoVenue.Side side, uint256 amountIn, uint256 price, uint16 feeBps)
        internal
        returns (SuiemDemoVenue.Quote memory q)
    {
        q = SuiemDemoVenue.Quote(trader, address(tsla), side, amountIn, price, feeBps, uint64(block.timestamp + 60), nextNonce++);
    }

    function sign(SuiemDemoVenue.Quote memory q, uint256 pk) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, venue.hashQuote(q));
        return abi.encodePacked(r, s, v);
    }

    function buyAs(address who, SuiemDemoVenue.Quote memory q, uint256 minOut) internal returns (uint256) {
        bytes memory sig = sign(q, signerPk);
        vm.startPrank(who);
        dusd.approve(address(venue), q.amountIn);
        uint256 out = venue.buy(q, sig, minOut);
        vm.stopPrank();
        return out;
    }

    // ---- metadata --------------------------------------------------------------------------
    function test_metadata_says_no_value() public view {
        assertEq(dusd.name(), "Suiem Demo USD (testnet, no value)");
        assertEq(dusd.symbol(), "dUSD");
        assertEq(dusd.decimals(), 6);
        assertEq(tsla.name(), "Suiem Demo TSLA (testnet, no value)");
        assertEq(tsla.symbol(), "dTSLA");
        assertEq(tsla.decimals(), 18);
    }

    // ---- happy paths -----------------------------------------------------------------------
    function test_buy_then_sell() public {
        // 100 dUSD at 250.00 dUSD/token, 10 bps fee
        SuiemDemoVenue.Quote memory q = quote(alice, SuiemDemoVenue.Side.Buy, 100e6, 250e6, 10);
        uint256 out = buyAs(alice, q, 0);
        // fee = ceil(100e6*10/1e4) = 100_000 ; net = 99_900_000 ; out = 99.9e6*1e18/250e6 = 0.3996e18
        assertEq(out, 0.3996e18);
        assertEq(tsla.balanceOf(alice), 0.3996e18);
        assertEq(dusd.balanceOf(alice), 900e6);
        assertEq(dusd.balanceOf(address(venue)), 100_000); // only the fee stays
        assertEq(dusd.allowance(alice, address(venue)), 0); // exact approve fully consumed

        SuiemDemoVenue.Quote memory s = quote(alice, SuiemDemoVenue.Side.Sell, 0.3996e18, 250e6, 10);
        bytes memory sig = sign(s, signerPk);
        vm.prank(alice);
        uint256 got = venue.sell(s, sig, 0);
        // gross = 99.9e6 ; fee = ceil(99_900) = 99_900 ; out = 99_800_100
        assertEq(got, 99_800_100);
        assertEq(tsla.balanceOf(alice), 0);
        assertEq(dusd.balanceOf(address(venue)), 100_000 + 99_900);
    }

    function test_trade_event() public {
        SuiemDemoVenue.Quote memory q = quote(alice, SuiemDemoVenue.Side.Buy, 10e6, 200e6, 0);
        bytes memory sig = sign(q, signerPk);
        vm.startPrank(alice);
        dusd.approve(address(venue), q.amountIn);
        vm.expectEmit(true, true, true, true, address(venue));
        emit SuiemDemoVenue.Trade(alice, address(tsla), SuiemDemoVenue.Side.Buy, 10e6, 0.05e18, 200e6, 0, q.nonce);
        venue.buy(q, sig, 0.05e18);
        vm.stopPrank();
    }

    // ---- quote checks ----------------------------------------------------------------------
    function test_replayed_nonce_reverts() public {
        SuiemDemoVenue.Quote memory q = quote(alice, SuiemDemoVenue.Side.Buy, 10e6, 200e6, 0);
        buyAs(alice, q, 0);
        bytes memory sig = sign(q, signerPk);
        vm.startPrank(alice);
        dusd.approve(address(venue), q.amountIn);
        vm.expectRevert(SuiemDemoVenue.NonceUsed.selector);
        venue.buy(q, sig, 0);
        vm.stopPrank();
    }

    function test_expiry_exact_boundary() public {
        SuiemDemoVenue.Quote memory q = quote(alice, SuiemDemoVenue.Side.Buy, 10e6, 200e6, 0);
        vm.warp(q.expiry); // at expiry: still valid
        buyAs(alice, q, 0);
        SuiemDemoVenue.Quote memory q2 = quote(alice, SuiemDemoVenue.Side.Buy, 10e6, 200e6, 0);
        bytes memory sig = sign(q2, signerPk);
        vm.warp(q2.expiry + 1); // one second later: expired
        vm.startPrank(alice);
        dusd.approve(address(venue), q2.amountIn);
        vm.expectRevert(SuiemDemoVenue.QuoteExpired.selector);
        venue.buy(q2, sig, 0);
        vm.stopPrank();
    }

    function test_quote_longer_than_60s_reverts() public {
        SuiemDemoVenue.Quote memory q = quote(alice, SuiemDemoVenue.Side.Buy, 10e6, 200e6, 0);
        q.expiry = uint64(block.timestamp + 61);
        bytes memory sig = sign(q, signerPk);
        vm.startPrank(alice);
        dusd.approve(address(venue), q.amountIn);
        vm.expectRevert(SuiemDemoVenue.QuoteTooLong.selector);
        venue.buy(q, sig, 0);
        vm.stopPrank();
    }

    function test_wrong_chain_id_signature_reverts() public {
        SuiemDemoVenue.Quote memory q = quote(alice, SuiemDemoVenue.Side.Buy, 10e6, 200e6, 0);
        bytes memory sig = sign(q, signerPk); // signed for 46630
        vm.chainId(4663); // same contract, different chain → different domain separator
        vm.startPrank(alice);
        dusd.approve(address(venue), q.amountIn);
        vm.expectRevert(SuiemDemoVenue.BadSignature.selector);
        venue.buy(q, sig, 0);
        vm.stopPrank();
    }

    function test_wrong_verifying_contract_reverts() public {
        SuiemDemoVenue other = new SuiemDemoVenue(owner, signer);
        SuiemDemoVenue.Quote memory q = quote(alice, SuiemDemoVenue.Side.Buy, 10e6, 200e6, 0);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, other.hashQuote(q)); // domain of another venue
        vm.startPrank(alice);
        dusd.approve(address(venue), q.amountIn);
        vm.expectRevert(SuiemDemoVenue.BadSignature.selector);
        venue.buy(q, abi.encodePacked(r, s, v), 0);
        vm.stopPrank();
    }

    function test_wrong_signer_reverts() public {
        SuiemDemoVenue.Quote memory q = quote(alice, SuiemDemoVenue.Side.Buy, 10e6, 200e6, 0);
        bytes memory sig = sign(q, 0xB0B);
        vm.startPrank(alice);
        dusd.approve(address(venue), q.amountIn);
        vm.expectRevert(SuiemDemoVenue.BadSignature.selector);
        venue.buy(q, sig, 0);
        vm.stopPrank();
    }

    function test_wrong_trader_reverts() public {
        SuiemDemoVenue.Quote memory q = quote(alice, SuiemDemoVenue.Side.Buy, 10e6, 200e6, 0);
        bytes memory sig = sign(q, signerPk);
        vm.prank(bob);
        vm.expectRevert(SuiemDemoVenue.NotTrader.selector);
        venue.buy(q, sig, 0);
    }

    function test_tampered_amount_reverts() public {
        SuiemDemoVenue.Quote memory q = quote(alice, SuiemDemoVenue.Side.Buy, 10e6, 200e6, 0);
        bytes memory sig = sign(q, signerPk);
        q.amountIn = 20e6;
        vm.startPrank(alice);
        dusd.approve(address(venue), q.amountIn);
        vm.expectRevert(SuiemDemoVenue.BadSignature.selector);
        venue.buy(q, sig, 0);
        vm.stopPrank();
    }

    function test_side_mismatch_reverts() public {
        SuiemDemoVenue.Quote memory q = quote(alice, SuiemDemoVenue.Side.Sell, 1e18, 200e6, 0);
        bytes memory sig = sign(q, signerPk);
        vm.prank(alice);
        vm.expectRevert(SuiemDemoVenue.BadSignature.selector);
        venue.buy(q, sig, 0);
    }

    function test_min_out_violation_reverts() public {
        SuiemDemoVenue.Quote memory q = quote(alice, SuiemDemoVenue.Side.Buy, 10e6, 200e6, 0);
        bytes memory sig = sign(q, signerPk);
        vm.startPrank(alice);
        dusd.approve(address(venue), q.amountIn);
        vm.expectRevert(abi.encodeWithSelector(SuiemDemoVenue.Slippage.selector, 0.05e18, 0.05e18 + 1));
        venue.buy(q, sig, 0.05e18 + 1);
        vm.stopPrank();
    }

    function test_unlisted_token_reverts() public {
        vm.prank(owner);
        venue.setListed(address(tsla), false);
        SuiemDemoVenue.Quote memory q = quote(alice, SuiemDemoVenue.Side.Buy, 10e6, 200e6, 0);
        bytes memory sig = sign(q, signerPk);
        vm.startPrank(alice);
        dusd.approve(address(venue), q.amountIn);
        vm.expectRevert(SuiemDemoVenue.NotListed.selector);
        venue.buy(q, sig, 0);
        vm.stopPrank();
    }

    function test_paused_reverts() public {
        vm.prank(owner);
        venue.pause();
        SuiemDemoVenue.Quote memory q = quote(alice, SuiemDemoVenue.Side.Buy, 10e6, 200e6, 0);
        bytes memory sig = sign(q, signerPk);
        vm.startPrank(alice);
        dusd.approve(address(venue), q.amountIn);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        venue.buy(q, sig, 0);
        vm.stopPrank();
    }

    function test_insufficient_allowance_reverts() public {
        SuiemDemoVenue.Quote memory q = quote(alice, SuiemDemoVenue.Side.Buy, 10e6, 200e6, 0);
        bytes memory sig = sign(q, signerPk);
        vm.startPrank(alice);
        dusd.approve(address(venue), q.amountIn - 1);
        vm.expectRevert();
        venue.buy(q, sig, 0);
        vm.stopPrank();
    }

    // ---- access control --------------------------------------------------------------------
    function test_non_venue_mint_and_burn_revert() public {
        vm.startPrank(alice);
        vm.expectRevert(DemoStockToken.OnlyVenue.selector);
        tsla.mint(alice, 1);
        vm.expectRevert(DemoStockToken.OnlyVenue.selector);
        tsla.burn(alice, 1);
        vm.expectRevert(DemoUSD.OnlyVenue.selector);
        dusd.mint(alice, 1);
        vm.expectRevert(DemoUSD.OnlyVenue.selector);
        dusd.burn(1);
        vm.stopPrank();
    }

    function test_admin_is_owner_only_and_two_step() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        venue.setQuoteSigner(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        venue.setListed(address(tsla), false);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        venue.pause();
        vm.stopPrank();
        vm.prank(owner);
        venue.transferOwnership(bob);
        assertEq(venue.owner(), owner); // pending until accepted
        vm.prank(bob);
        venue.acceptOwnership();
        assertEq(venue.owner(), bob);
        vm.prank(bob);
        vm.expectRevert(SuiemDemoVenue.AlreadySet.selector);
        venue.setDemoUSD(dusd);
    }

    // ---- faucet ----------------------------------------------------------------------------
    function test_faucet_cooldown() public {
        vm.prank(bob);
        dusd.claim();
        assertEq(dusd.balanceOf(bob), 1_000e6);
        vm.warp(block.timestamp + 24 hours - 1);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(DemoUSD.ClaimCooldown.selector, block.timestamp + 1));
        dusd.claim();
        vm.warp(block.timestamp + 1);
        vm.prank(bob);
        dusd.claim();
        assertEq(dusd.balanceOf(bob), 2_000e6);
    }

    // ---- fuzz: rounding never favours the trader ---------------------------------------------
    function testFuzz_buy_rounding_favours_venue(uint256 amountIn, uint256 price, uint16 feeBps) public view {
        amountIn = bound(amountIn, 1, 1e15); // up to 1bn dUSD
        price = bound(price, 1, 1e13); // up to 10m dUSD per token
        feeBps = uint16(bound(feeBps, 0, 100));
        (uint256 out, uint256 fee) = venue.previewOut(SuiemDemoVenue.Side.Buy, amountIn, price, feeBps);
        uint256 net = amountIn - fee;
        assertGe(fee * 10_000, amountIn * feeBps); // fee rounds up
        // value of tokens received at the signed price never exceeds what was paid net of fee
        assertLe(out * price, net * 1e18);
        assertGt((out + 1) * price, net * 1e18); // and is the largest such amount
    }

    function testFuzz_sell_rounding_favours_venue(uint256 amountIn, uint256 price, uint16 feeBps) public view {
        amountIn = bound(amountIn, 1, 1e27);
        price = bound(price, 1, 1e13);
        feeBps = uint16(bound(feeBps, 0, 100));
        (uint256 out, uint256 fee) = venue.previewOut(SuiemDemoVenue.Side.Sell, amountIn, price, feeBps);
        assertLe((out + fee) * 1e18, amountIn * price); // never more dUSD than the tokens are worth
        assertGe(fee * 10_000, (out + fee) * feeBps);
    }

    function testFuzz_buy_sell_round_trip_never_profits(uint256 amountIn, uint256 price) public {
        amountIn = bound(amountIn, 1e6, 1_000e6);
        price = bound(price, 1e6, 5_000e6);
        uint256 out = buyAs(alice, quote(alice, SuiemDemoVenue.Side.Buy, amountIn, price, 10), 0);
        vm.assume(out > 0);
        SuiemDemoVenue.Quote memory s = quote(alice, SuiemDemoVenue.Side.Sell, out, price, 10);
        bytes memory sig = sign(s, signerPk);
        uint256 before = dusd.balanceOf(alice);
        vm.prank(alice);
        try venue.sell(s, sig, 0) returns (uint256 got) {
            assertLe(got, amountIn);
            assertEq(dusd.balanceOf(alice), before + got);
        } catch {
            // dust sells that round to zero revert (ZeroAmount): still no profit
        }
    }
}

/// @notice Invariant: dUSD paid in = fees kept + dUSD burned, and the value of minted demo stock at
///         the signed price never exceeds the dUSD burned for it.
contract VenueHandler is Test {
    SuiemDemoVenue public venue;
    DemoUSD public dusd;
    DemoStockToken public tsla;
    uint256 public pk;
    address public trader = makeAddr("trader");
    uint256 public nonce = 1_000_000;
    uint256 public paidIn;
    uint256 public feesKept;
    uint256 public mintedValueScaled; // sum(out * price), 1e18-scaled dUSD
    uint256 public netScaled; // sum(net * 1e18)

    constructor(SuiemDemoVenue v, DemoUSD d, DemoStockToken t, uint256 pk_) {
        venue = v;
        dusd = d;
        tsla = t;
        pk = pk_;
    }

    function buy(uint256 amountIn, uint256 price) external {
        amountIn = bound(amountIn, 1, 50e6);
        price = bound(price, 1, 10_000e6);
        if (dusd.balanceOf(trader) < amountIn) {
            vm.warp(block.timestamp + 1 days);
            vm.prank(trader);
            dusd.claim();
        }
        SuiemDemoVenue.Quote memory q = SuiemDemoVenue.Quote(trader, address(tsla), SuiemDemoVenue.Side.Buy, amountIn, price, 10, uint64(block.timestamp + 30), nonce++);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, venue.hashQuote(q));
        (uint256 expectOut, uint256 fee) = venue.previewOut(SuiemDemoVenue.Side.Buy, amountIn, price, 10);
        if (expectOut == 0) return;
        vm.startPrank(trader);
        dusd.approve(address(venue), amountIn);
        uint256 out = venue.buy(q, abi.encodePacked(r, s, v), 0);
        vm.stopPrank();
        paidIn += amountIn;
        feesKept += fee;
        mintedValueScaled += out * price;
        netScaled += (amountIn - fee) * 1e18;
    }
}

contract VenueInvariantTest is Test {
    VenueHandler handler;
    SuiemDemoVenue venue;
    DemoUSD dusd;

    function setUp() public {
        vm.chainId(46630);
        vm.warp(1_800_000_000);
        uint256 pk = 0xA11CE;
        venue = new SuiemDemoVenue(address(this), vm.addr(pk));
        dusd = new DemoUSD(address(venue));
        DemoStockToken tsla = new DemoStockToken("TSLA", address(venue));
        venue.setDemoUSD(dusd);
        venue.setListed(address(tsla), true);
        handler = new VenueHandler(venue, dusd, tsla, pk);
        targetContract(address(handler));
        bytes4[] memory sel = new bytes4[](1);
        sel[0] = VenueHandler.buy.selector;
        targetSelector(FuzzSelector(address(handler), sel));
    }

    function invariant_dusd_in_equals_fees_plus_burned_and_stock_value_bounded() public view {
        // The venue only ever holds the fees.
        assertEq(dusd.balanceOf(address(venue)), handler.feesKept());
        // Minted stock value at the signed price never exceeds the dUSD burned for it.
        assertLe(handler.mintedValueScaled(), handler.netScaled());
        assertEq(handler.paidIn(), handler.feesKept() + handler.netScaled() / 1e18);
    }
}
