// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IOptimisticOracle {
    function requestPrice(
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData,
        address currency,
        uint256 reward
    ) external returns (uint256);

    function settle(
        address requester,
        bytes32 identifier,
        uint256 timestamp,
        bytes memory ancillaryData
    ) external returns (int256);
}

contract PredictionChaining {
    enum Outcome { Pending, Yes, No }

    struct Prediction {
        string question;
        uint256 stake;
        address setter;
        Outcome result;
        bool resolved;
        uint256 totalYes;
        uint256 totalNo;
        uint256 createdAt;
        string[] tags;
    }

    IOptimisticOracle public oo;
    bytes32 public constant IDENTIFIER = keccak256("YES_OR_NO_QUERY");

    uint256 public predictionCount;

    mapping(uint256 => Prediction) public predictions;
    mapping(address => mapping(uint256 => mapping(bool => uint256))) public bets;
    mapping(address => mapping(uint256 => uint256)) public userExposure;

    mapping(uint256 => uint256) public requestTime;
    mapping(uint256 => bytes) public ancillaryDataMap;

    // 🔒 Prevent oracle hijack (set only once)
    function setOracle(address _oo) external {
        require(address(oo) == address(0), "Oracle already set");
        oo = IOptimisticOracle(_oo);
    }

    function createPrediction(
        string calldata q,
        uint256 stake,
        string[] calldata tags
    ) external {
        predictionCount++;

        Prediction storage p = predictions[predictionCount];
        p.question = q;
        p.stake = stake;
        p.setter = msg.sender;
        p.result = Outcome.Pending;
        p.resolved = false;
        p.createdAt = block.timestamp;

        for (uint256 i = 0; i < tags.length; i++) {
            p.tags.push(tags[i]);
        }
    }

    function bet(uint256 id, bool yes) external payable {
        require(id > 0 && id <= predictionCount, "Invalid ID");

        Prediction storage p = predictions[id];
        require(!p.resolved, "Resolved");
        require(msg.value == p.stake, "Wrong stake");

        bets[msg.sender][id][yes] += msg.value;
        userExposure[msg.sender][id] += msg.value;

        if (yes) {
            p.totalYes += msg.value;
        } else {
            p.totalNo += msg.value;
        }
    }

    function branchPrediction(
        uint256 fromId,
        uint256 toId,
        bool yesOnTarget,
        uint256 amount
    ) external {
        require(fromId > 0 && fromId <= predictionCount, "Invalid fromId");
        require(toId > 0 && toId <= predictionCount, "Invalid toId");

        Prediction storage fromP = predictions[fromId];
        Prediction storage toP = predictions[toId];

        require(!fromP.resolved, "Source resolved");
        require(!toP.resolved, "Target resolved");
        require(fromId != toId, "Same prediction");

        uint256 exposure = userExposure[msg.sender][fromId];
        require(exposure >= amount, "Insufficient exposure");

        // reduce exposure from source
        userExposure[msg.sender][fromId] -= amount;

        // add exposure to target
        userExposure[msg.sender][toId] += amount;
        bets[msg.sender][toId][yesOnTarget] += amount;

        if (yesOnTarget) {
            toP.totalYes += amount;
        } else {
            toP.totalNo += amount;
        }
    }

    function claim(uint256 id) external {
        require(id > 0 && id <= predictionCount, "Invalid ID");

        Prediction storage p = predictions[id];
        require(p.resolved, "Not resolved");

        bool winYes = p.result == Outcome.Yes && bets[msg.sender][id][true] > 0;
        bool winNo = p.result == Outcome.No && bets[msg.sender][id][false] > 0;
        require(winYes || winNo, "Lost");

        uint256 userBet = winYes
            ? bets[msg.sender][id][true]
            : bets[msg.sender][id][false];

        uint256 pool = p.totalYes + p.totalNo;
        uint256 winPool = p.result == Outcome.Yes ? p.totalYes : p.totalNo;

        uint256 payout = (userBet * pool) / winPool;

        bets[msg.sender][id][true] = 0;
        bets[msg.sender][id][false] = 0;
        userExposure[msg.sender][id] = 0;

        payable(msg.sender).transfer(payout);
    }

    // ---------------- UMA RESOLUTION ----------------

    function requestResolution(uint256 id) external {
        require(address(oo) != address(0), "Oracle not set");
        require(id > 0 && id <= predictionCount, "Invalid ID");
        require(requestTime[id] == 0, "Already requested");

        Prediction storage p = predictions[id];
        require(!p.resolved, "Already resolved");

        bytes memory ancillaryData = abi.encodePacked(
            "Q:", p.question,
            ", Type:YES_OR_NO"
        );

        uint256 timestamp = block.timestamp;

        oo.requestPrice(
            IDENTIFIER,
            timestamp,
            ancillaryData,
            address(0),
            0
        );

        requestTime[id] = timestamp;
        ancillaryDataMap[id] = ancillaryData;
    }

    function settleResolution(uint256 id) external {
        require(address(oo) != address(0), "Oracle not set");
        require(id > 0 && id <= predictionCount, "Invalid ID");

        Prediction storage p = predictions[id];
        require(!p.resolved, "Already resolved");

        uint256 timestamp = requestTime[id];
        require(timestamp != 0, "Not requested");

        bytes memory ancillaryData = ancillaryDataMap[id];

        int256 outcome = oo.settle(
            address(this),
            IDENTIFIER,
            timestamp,
            ancillaryData
        );

        require(outcome == 0 || outcome == 1, "Invalid oracle value");

        p.result = outcome == 1 ? Outcome.Yes : Outcome.No;
        p.resolved = true;
    }
}