// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice The subset of the $WIF token this contract uses. Verified onchain for $WIF on
///         Robinhood Chain mainnet 4663 (docs/VERIFIED_FACTS.md W-16): `burnFrom` spends the
///         caller's allowance and lowers `totalSupply` by exactly `amount`.
interface IBurnableERC20 {
    function burnFrom(address account, uint256 amount) external;
    function totalSupply() external view returns (uint256);
    function decimals() external view returns (uint8);
}

/// @title Suiem community elections (burn-to-vote with $WIF)
/// @notice Voters burn whole $WIF to vote for a candidate: 1 $WIF = 1 vote, linear, capped per
///         wallet per election. Burned tokens are destroyed: votes are final and are never refunded,
///         not even when an election is cancelled.
/// @dev    Immutable code: no proxy, no delegatecall, no pause, no withdraw, no payable function.
///         The contract never holds $WIF or ETH: `vote` burns straight from the voter with
///         `burnFrom` (the voter approves this contract for the exact amount).
///         Owner powers: create an election, add candidates before it starts and cancel it before it
///         starts. Nothing about an election can change once it has started. Anyone may finalize
///         after the end. Candidates are sequential ids (1..candidateCount); who they are is
///         recorded off-chain, so nothing personal is stored onchain.
///         `SafeERC20` does not apply: the only token call is `burnFrom`, which reverts on failure,
///         and its effect is checked through `totalSupply` anyway.
contract SuiemElections is Ownable2Step, ReentrancyGuard {
    /// @notice Stored lifecycle state. `Open` and `Closed` are derived from `block.timestamp`.
    enum Status {
        Scheduled,
        Cancelled,
        Finalized
    }

    /// @notice What `phase` reports: the stored status combined with the clock.
    enum Phase {
        Scheduled,
        Open,
        Closed,
        Finalized,
        Cancelled
    }

    struct Election {
        uint64 startTime;
        uint64 endTime;
        uint64 capPerWallet;
        uint8 candidateCount;
        Status status;
        uint256 totalVotes;
    }

    /// @notice Upper bound on candidates per election (PO decision: up to 8).
    uint8 public constant MAX_CANDIDATES = 8;
    /// @notice One vote costs exactly one whole token (18 decimals).
    uint256 public constant TOKEN_PER_VOTE = 1e18;

    /// @notice The vote asset ($WIF on mainnet). Fixed at deployment.
    IBurnableERC20 public immutable WIF;

    /// @notice Number of elections created; ids run from 1 to `electionCount`.
    uint256 public electionCount;
    mapping(uint256 electionId => Election) private _elections;
    /// @notice Votes per candidate per election.
    mapping(uint256 electionId => mapping(uint256 candidateId => uint256)) public votes;
    /// @notice Votes already cast by a wallet in an election (counts against the cap).
    mapping(uint256 electionId => mapping(address voter => uint256)) public votedBy;

    /// @notice A new election. Candidates 1..candidateCount exist from this point.
    event ElectionCreated(
        uint256 indexed electionId, uint64 startTime, uint64 endTime, uint64 capPerWallet, uint8 candidateCount
    );
    /// @notice Candidates were appended before the start; the election now has `candidateCount`.
    event CandidatesAdded(uint256 indexed electionId, uint8 candidateCount);
    /// @notice A vote was counted.
    event VoteCast(uint256 indexed electionId, uint256 indexed candidateId, address indexed voter, uint256 votes);
    /// @notice `amount` $WIF base units were burned for that vote; `totalSupply` fell by exactly `amount`.
    event VoteAssetBurned(
        uint256 indexed electionId, uint256 indexed candidateId, address indexed voter, uint256 amount
    );
    /// @notice The election was finalized after its end.
    event ElectionFinalized(uint256 indexed electionId, uint256 totalVotes);
    /// @notice The election was cancelled before it started (no votes were possible).
    event ElectionCancelled(uint256 indexed electionId);

    error ZeroAddress();
    error BadDecimals();
    error BadWindow();
    error BadCap();
    error BadCandidateCount();
    error UnknownElection();
    error AlreadyStarted();
    error NotScheduled();
    error NotOpen();
    error UnknownCandidate();
    error ZeroVotes();
    error CapExceeded(uint256 remaining);
    error NotEnded();
    error BurnNotEffective();

    /// @param owner_ The first owner (a fresh deployer EOA; ownership moves via Ownable2Step).
    /// @param wif The vote asset. Must report 18 decimals.
    constructor(address owner_, IBurnableERC20 wif) Ownable(owner_) {
        if (address(wif) == address(0)) revert ZeroAddress();
        if (wif.decimals() != 18) revert BadDecimals();
        WIF = wif;
    }

    // ---- owner ----------------------------------------------------------------------------

    /// @notice Create an election that opens at `startTime` (in the future) and closes at `endTime`.
    /// @param startTime First second voting is allowed (inclusive).
    /// @param endTime First second voting is no longer allowed (exclusive).
    /// @param capPerWallet Most votes one wallet may cast in this election.
    /// @param candidateCount Number of candidates (ids 1..candidateCount), at most `MAX_CANDIDATES`.
    /// @return electionId The new election's id.
    function createElection(uint64 startTime, uint64 endTime, uint64 capPerWallet, uint8 candidateCount)
        external
        onlyOwner
        returns (uint256 electionId)
    {
        if (startTime <= block.timestamp || endTime <= startTime) revert BadWindow();
        if (capPerWallet == 0) revert BadCap();
        if (candidateCount == 0 || candidateCount > MAX_CANDIDATES) revert BadCandidateCount();
        electionId = ++electionCount;
        _elections[electionId] = Election(startTime, endTime, capPerWallet, candidateCount, Status.Scheduled, 0);
        emit ElectionCreated(electionId, startTime, endTime, capPerWallet, candidateCount);
    }

    /// @notice Append `count` candidates to an election that has not started yet.
    function addCandidates(uint256 electionId, uint8 count) external onlyOwner {
        Election storage e = _beforeStart(electionId);
        uint256 total = uint256(e.candidateCount) + count;
        if (count == 0 || total > MAX_CANDIDATES) revert BadCandidateCount();
        e.candidateCount = uint8(total);
        emit CandidatesAdded(electionId, uint8(total));
    }

    /// @notice Cancel an election that has not started yet. No votes can exist at that point.
    function cancel(uint256 electionId) external onlyOwner {
        Election storage e = _beforeStart(electionId);
        e.status = Status.Cancelled;
        emit ElectionCancelled(electionId);
    }

    // ---- anyone ---------------------------------------------------------------------------

    /// @notice Burn `voteCount` whole $WIF from the caller to vote for `candidateId`.
    /// @dev The caller must first `approve(this, voteCount * 1e18)`. Reverts unless the election is
    ///      open (`startTime <= block.timestamp < endTime`), the candidate exists, `voteCount > 0`,
    ///      the wallet cap is respected and `totalSupply` drops by exactly the burned amount.
    function vote(uint256 electionId, uint256 candidateId, uint256 voteCount) external nonReentrant {
        Election storage e = _get(electionId);
        if (e.status != Status.Scheduled || block.timestamp < e.startTime || block.timestamp >= e.endTime) {
            revert NotOpen();
        }
        if (candidateId == 0 || candidateId > e.candidateCount) revert UnknownCandidate();
        if (voteCount == 0) revert ZeroVotes();
        uint256 used = votedBy[electionId][msg.sender];
        if (voteCount > e.capPerWallet - used) revert CapExceeded(e.capPerWallet - used);

        votedBy[electionId][msg.sender] = used + voteCount;
        votes[electionId][candidateId] += voteCount;
        e.totalVotes += voteCount;

        uint256 amount = voteCount * TOKEN_PER_VOTE;
        uint256 supplyBefore = WIF.totalSupply();
        WIF.burnFrom(msg.sender, amount);
        if (supplyBefore - WIF.totalSupply() != amount) revert BurnNotEffective();

        emit VoteCast(electionId, candidateId, msg.sender, voteCount);
        emit VoteAssetBurned(electionId, candidateId, msg.sender, amount);
    }

    /// @notice Finalize an election after its end. Callable by anyone, once.
    function finalize(uint256 electionId) external {
        Election storage e = _get(electionId);
        if (e.status != Status.Scheduled) revert NotScheduled();
        if (block.timestamp < e.endTime) revert NotEnded();
        e.status = Status.Finalized;
        emit ElectionFinalized(electionId, e.totalVotes);
    }

    // ---- views ----------------------------------------------------------------------------

    /// @notice The stored election record.
    function getElection(uint256 electionId) external view returns (Election memory) {
        return _get(electionId);
    }

    /// @notice Lifecycle phase now: Scheduled, Open, Closed (ended, not finalized), Finalized or Cancelled.
    function phase(uint256 electionId) public view returns (Phase) {
        Election storage e = _get(electionId);
        if (e.status == Status.Cancelled) return Phase.Cancelled;
        if (e.status == Status.Finalized) return Phase.Finalized;
        if (block.timestamp < e.startTime) return Phase.Scheduled;
        if (block.timestamp < e.endTime) return Phase.Open;
        return Phase.Closed;
    }

    /// @notice Votes per candidate; index 0 is candidate 1.
    function tallies(uint256 electionId) external view returns (uint256[] memory result) {
        Election storage e = _get(electionId);
        result = new uint256[](e.candidateCount);
        for (uint256 i = 0; i < e.candidateCount; i++) {
            result[i] = votes[electionId][i + 1];
        }
    }

    /// @notice Votes `voter` may still cast in `electionId`.
    function remainingCap(uint256 electionId, address voter) external view returns (uint256) {
        return _get(electionId).capPerWallet - votedBy[electionId][voter];
    }

    // ---- internal -------------------------------------------------------------------------

    function _get(uint256 electionId) private view returns (Election storage e) {
        e = _elections[electionId];
        if (e.endTime == 0) revert UnknownElection();
    }

    function _beforeStart(uint256 electionId) private view returns (Election storage e) {
        e = _get(electionId);
        if (e.status != Status.Scheduled) revert NotScheduled();
        if (block.timestamp >= e.startTime) revert AlreadyStarted();
    }
}
