// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DemoStockToken} from "./DemoStockToken.sol";
import {DemoUSD} from "./DemoUSD.sol";

/// @title Suiem demo venue (testnet only, no value)
/// @notice Buys and sells Suiem demo tokens for dUSD at a price signed by the Suiem quote signer
///         (EIP-712). The trader signs and sends the transaction themselves. No upgradeability.
///         Holds no user funds: dUSD paid for a buy is burned except the fee, which stays here.
/// @dev Pricing: `price` is dUSD base units (6 decimals) per 1e18 demo-token base units (one whole
///      token). All rounding favours the venue, so a trader can never gain from rounding.
contract SuiemDemoVenue is EIP712, Ownable2Step, Pausable {
    using SafeERC20 for IERC20;

    enum Side {
        Buy,
        Sell
    }

    struct Quote {
        address trader;
        address token;
        Side side;
        uint256 amountIn;
        uint256 price;
        uint16 feeBps;
        uint64 expiry;
        uint256 nonce;
    }

    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(address trader,address token,uint8 side,uint256 amountIn,uint256 price,uint16 feeBps,uint64 expiry,uint256 nonce)"
    );
    uint256 public constant MAX_QUOTE_TTL = 60;
    uint16 public constant MAX_FEE_BPS = 100;
    uint256 private constant ONE_TOKEN = 1e18;

    DemoUSD public dusd;
    address public quoteSigner;
    mapping(address token => bool) public listed;
    mapping(uint256 nonce => bool) public nonceUsed;

    event Trade(
        address indexed trader,
        address indexed token,
        Side side,
        uint256 amountIn,
        uint256 amountOut,
        uint256 price,
        uint256 fee,
        uint256 indexed nonce
    );
    event QuoteSignerSet(address signer);
    event TokenListed(address token, bool isListed);
    event DemoUSDSet(address dusd);

    error BadSignature();
    error NotTrader();
    error QuoteExpired();
    error QuoteTooLong();
    error NonceUsed();
    error NotListed();
    error Slippage(uint256 out, uint256 minOut);
    error ZeroAmount();
    error FeeTooHigh();
    error ZeroAddress();
    error AlreadySet();

    constructor(address owner_, address quoteSigner_) EIP712("SuiemDemoVenue", "1") Ownable(owner_) {
        if (quoteSigner_ == address(0)) revert ZeroAddress();
        quoteSigner = quoteSigner_;
        emit QuoteSignerSet(quoteSigner_);
    }

    // ---- admin -------------------------------------------------------------------------------
    /// @notice One-time wiring of dUSD (dUSD is deployed after the venue because it fixes the venue).
    function setDemoUSD(DemoUSD dusd_) external onlyOwner {
        if (address(dusd) != address(0)) revert AlreadySet();
        if (address(dusd_) == address(0)) revert ZeroAddress();
        dusd = dusd_;
        emit DemoUSDSet(address(dusd_));
    }

    function setQuoteSigner(address signer) external onlyOwner {
        if (signer == address(0)) revert ZeroAddress();
        quoteSigner = signer;
        emit QuoteSignerSet(signer);
    }

    function setListed(address token, bool isListed) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        listed[token] = isListed;
        emit TokenListed(token, isListed);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---- quotes ------------------------------------------------------------------------------
    function hashQuote(Quote calldata q) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(QUOTE_TYPEHASH, q.trader, q.token, q.side, q.amountIn, q.price, q.feeBps, q.expiry, q.nonce)
            )
        );
    }

    /// @notice Output for a quote, rounding down (toward the venue). Returns (amountOut, fee).
    function previewOut(Side side, uint256 amountIn, uint256 price, uint16 feeBps)
        public
        pure
        returns (uint256 out, uint256 fee)
    {
        if (side == Side.Buy) {
            // fee rounds UP (toward the venue), tokens out round DOWN.
            fee = _ceilDiv(amountIn * feeBps, 10_000);
            out = ((amountIn - fee) * ONE_TOKEN) / price;
        } else {
            uint256 gross = (amountIn * price) / ONE_TOKEN;
            fee = _ceilDiv(gross * feeBps, 10_000);
            out = gross - fee;
        }
    }

    function buy(Quote calldata q, bytes calldata sig, uint256 minOut) external whenNotPaused returns (uint256 out) {
        if (q.side != Side.Buy) revert BadSignature();
        uint256 fee;
        (out, fee) = _check(q, sig, minOut);
        IERC20(address(dusd)).safeTransferFrom(msg.sender, address(this), q.amountIn);
        dusd.burn(q.amountIn - fee); // the fee stays with the venue
        DemoStockToken(q.token).mint(msg.sender, out);
        emit Trade(msg.sender, q.token, Side.Buy, q.amountIn, out, q.price, fee, q.nonce);
    }

    function sell(Quote calldata q, bytes calldata sig, uint256 minOut) external whenNotPaused returns (uint256 out) {
        if (q.side != Side.Sell) revert BadSignature();
        uint256 fee;
        (out, fee) = _check(q, sig, minOut);
        DemoStockToken(q.token).burn(msg.sender, q.amountIn);
        dusd.mint(msg.sender, out);
        if (fee > 0) dusd.mint(address(this), fee);
        emit Trade(msg.sender, q.token, Side.Sell, q.amountIn, out, q.price, fee, q.nonce);
    }

    function _check(Quote calldata q, bytes calldata sig, uint256 minOut) private returns (uint256 out, uint256 fee) {
        if (msg.sender != q.trader) revert NotTrader();
        // C-18: block.timestamp, never block.number.
        if (block.timestamp > q.expiry) revert QuoteExpired();
        if (q.expiry > block.timestamp + MAX_QUOTE_TTL) revert QuoteTooLong();
        if (nonceUsed[q.nonce]) revert NonceUsed();
        if (!listed[q.token]) revert NotListed();
        if (q.amountIn == 0 || q.price == 0) revert ZeroAmount();
        if (q.feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        if (ECDSA.recover(hashQuote(q), sig) != quoteSigner) revert BadSignature();
        nonceUsed[q.nonce] = true;
        (out, fee) = previewOut(q.side, q.amountIn, q.price, q.feeBps);
        if (out == 0) revert ZeroAmount();
        if (out < minOut) revert Slippage(out, minOut);
    }

    function _ceilDiv(uint256 a, uint256 b) private pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }
}
