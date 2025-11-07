pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract VotingSystem is ZamaEthereumConfig {
    struct Vote {
        euint32 encryptedVote;
        address voter;
        uint256 timestamp;
        bool revealed;
    }

    struct Poll {
        string title;
        string[] options;
        uint256 startTime;
        uint256 endTime;
        bool active;
        mapping(uint256 => uint256) publicResults;
        mapping(uint256 => uint256) encryptedResults;
    }

    mapping(uint256 => Poll) public polls;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => Vote[]) public votes;
    uint256 public pollCount;

    event PollCreated(uint256 pollId, string title, string[] options);
    event VoteCast(uint256 pollId, address voter);
    event ResultsRevealed(uint256 pollId);

    constructor() ZamaEthereumConfig() {
        pollCount = 0;
    }

    function createPoll(
        string calldata title, 
        string[] calldata options,
        uint256 duration
    ) external {
        uint256 pollId = pollCount++;
        Poll storage p = polls[pollId];
        p.title = title;
        p.options = options;
        p.startTime = block.timestamp;
        p.endTime = block.timestamp + duration;
        p.active = true;

        emit PollCreated(pollId, title, options);
    }

    function castVote(
        uint256 pollId,
        externalEuint32 encryptedVote,
        bytes calldata inputProof
    ) external {
        require(polls[pollId].active, "Poll is not active");
        require(block.timestamp >= polls[pollId].startTime, "Voting has not started");
        require(block.timestamp <= polls[pollId].endTime, "Voting has ended");
        require(!hasVoted[pollId][msg.sender], "Already voted");

        require(FHE.isInitialized(FHE.fromExternal(encryptedVote, inputProof)), "Invalid encrypted vote");

        euint32 vote = FHE.fromExternal(encryptedVote, inputProof);
        FHE.allowThis(vote);
        FHE.makePubliclyDecryptable(vote);

        votes[pollId].push(Vote({
            encryptedVote: vote,
            voter: msg.sender,
            timestamp: block.timestamp,
            revealed: false
        }));

        hasVoted[pollId][msg.sender] = true;

        emit VoteCast(pollId, msg.sender);
    }

    function revealResults(uint256 pollId) external {
        require(block.timestamp > polls[pollId].endTime, "Voting still in progress");
        require(polls[pollId].active, "Results already revealed");

        for (uint256 i = 0; i < votes[pollId].length; i++) {
            if (!votes[pollId][i].revealed) {
                uint32 decryptedVote = FHE.decrypt(votes[pollId][i].encryptedVote);
                polls[pollId].publicResults[decryptedVote]++;
                votes[pollId][i].revealed = true;
            }
        }

        polls[pollId].active = false;
        emit ResultsRevealed(pollId);
    }

    function getPoll(uint256 pollId) external view returns (
        string memory title,
        string[] memory options,
        uint256 startTime,
        uint256 endTime,
        bool active
    ) {
        Poll storage p = polls[pollId];
        return (p.title, p.options, p.startTime, p.endTime, p.active);
    }

    function getResults(uint256 pollId) external view returns (uint256[] memory) {
        require(!polls[pollId].active, "Poll still active");
        
        uint256[] memory results = new uint256[](polls[pollId].options.length);
        for (uint256 i = 0; i < polls[pollId].options.length; i++) {
            results[i] = polls[pollId].publicResults[i];
        }
        return results;
    }

    function getVote(uint256 pollId, uint256 index) external view returns (
        euint32 encryptedVote,
        address voter,
        uint256 timestamp,
        bool revealed
    ) {
        require(index < votes[pollId].length, "Invalid vote index");
        Vote storage v = votes[pollId][index];
        return (v.encryptedVote, v.voter, v.timestamp, v.revealed);
    }

    function getTotalPolls() external view returns (uint256) {
        return pollCount;
    }

    function getTotalVotes(uint256 pollId) external view returns (uint256) {
        return votes[pollId].length;
    }
}

