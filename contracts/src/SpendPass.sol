// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Native token task acceptance fees, not proof of execution or quality.
contract SpendPass {
    uint256 public constant MAX_ROOT_FEE = 0.002 ether;
    uint256 public constant MAX_CHILD = 0.004 ether;
    uint256 public constant MAX_CHILDREN_TOTAL = 0.008 ether;
    enum OfferState { None, Offered, Accepted, Cancelled, Expired }
    struct Policy {
        address owner; address delegate; address rootOperator; address rootPayee;
        address childOperator; address childPayee;
        uint256 totalBudget; uint256 rootFeeMax; uint256 perChildMax;
        uint256 childrenTotalMax; uint256 expiry;
    }
    struct Grant {
        bytes32 rootId; uint256 originalAllocation; uint256 free; uint256 held;
        uint256 providerUnclaimed; uint256 providerClaimed; uint256 ownerWithdrawn;
        uint256 delegatedOutstanding; uint8 depth;
    }
    struct Quote {
        bytes32 grantId; address operator; address payee; bytes32 taskInputHash;
        bytes32 modelHash; uint256 fee; uint256 expiry; uint256 nonce; bytes32 policyHash;
    }
    struct Offer { OfferState state; address operator; address payee; uint256 fee; uint256 expiry; bytes32 quoteHash; }
    mapping(bytes32 => Policy) public policies;
    mapping(bytes32 => Grant) public grants;
    mapping(bytes32 => Offer) public offers;
    mapping(bytes32 => bytes32) public policyHash;
    mapping(bytes32 => bool) public closing;
    mapping(bytes32 => bool) public didSplit;
    mapping(address => uint256) public creationNonce;
    bytes32[] public roots;
    mapping(bytes32 => uint8) public childCount;
    uint256 public registeredFunding;
    uint256 public paidOut;
    uint256 private entered;
    bytes32 public constant QUOTE_TYPEHASH = keccak256("Quote(bytes32 grantId,address operator,address payee,bytes32 taskInputHash,bytes32 modelHash,uint256 fee,uint256 expiry,uint256 nonce,bytes32 policyHash,address assetNativeMON)");
    event RootCreated(bytes32 indexed rootId, address indexed owner, bytes32 policyHash, uint256 amount);
    event Reserved(bytes32 indexed grantId, bytes32 indexed offerId, bytes32 quoteHash, uint256 fee);
    event Accepted(bytes32 indexed grantId, address indexed payee, uint256 fee);
    event Released(bytes32 indexed grantId, OfferState state);
    event Split(bytes32 indexed rootId, uint256 count, uint256 allocation);
    event Closed(bytes32 indexed rootId);
    event Claimed(bytes32 indexed grantId, address indexed payee, uint256 amount);
    event Withdrawn(bytes32 indexed grantId, address indexed owner, uint256 amount);
    modifier nonReentrant() { require(entered == 0, "reentrant"); entered = 1; _; entered = 0; }
    function domainSeparator() public view returns(bytes32) {
        return keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"), keccak256("CATS SpendPass"), keccak256("1"), block.chainid, address(this)));
    }
    function quoteDigest(Quote memory q) public view returns(bytes32) {
        bytes32 s = keccak256(abi.encode(QUOTE_TYPEHASH,q.grantId,q.operator,q.payee,q.taskInputHash,q.modelHash,q.fee,q.expiry,q.nonce,q.policyHash,address(0)));
        return keccak256(abi.encodePacked("\x19\x01",domainSeparator(),s));
    }
    function offerId(bytes32 id) public pure returns(bytes32) { return keccak256(abi.encode(id, uint256(0))); }
    function childId(bytes32 root, uint256 index) public pure returns(bytes32) { require(index < 2,"depth/count"); return keccak256(abi.encode(root,index)); }
    function rootCount() external view returns(uint256) { return roots.length; }
    function createRoot(Policy calldata p) external payable returns(bytes32 id) {
        require(p.owner == msg.sender && p.delegate != address(0), "owner/delegate");
        require(p.delegate == p.rootOperator && p.rootOperator != p.childOperator, "fixed A/B policy");
        require(p.rootOperator != address(0) && p.rootPayee != address(0) && p.childOperator != address(0) && p.childPayee != address(0), "party");
        require(p.totalBudget > 0 && p.totalBudget <= 0.010 ether && msg.value == p.totalBudget, "deposit");
        require(p.rootFeeMax > 0 && p.rootFeeMax <= MAX_ROOT_FEE && p.perChildMax > 0 && p.perChildMax <= MAX_CHILD && p.childrenTotalMax <= MAX_CHILDREN_TOTAL, "caps");
        require(p.expiry > block.timestamp, "expiry");
        id = keccak256(abi.encode(block.chainid,address(this),p.owner,creationNonce[p.owner]++));
        policies[id] = p; policyHash[id] = keccak256(abi.encode(p));
        grants[id] = Grant(id,p.totalBudget,p.totalBudget,0,0,0,0,0,1);
        roots.push(id); registeredFunding += msg.value;
        emit RootCreated(id,p.owner,policyHash[id],msg.value);
    }
    function _active(bytes32 root) internal view { require(!closing[root] && block.timestamp < policies[root].expiry, "inactive"); }
    function reserve(Quote calldata q, bytes calldata sig) external {
        Grant storage g = grants[q.grantId]; require(g.depth != 0,"grant");
        Policy storage p = policies[g.rootId]; _active(g.rootId);
        require(msg.sender == p.delegate,"delegate");
        require(offers[q.grantId].state == OfferState.None,"slot consumed");
        require(q.policyHash == policyHash[g.rootId],"policy");
        require(q.operator == (g.depth == 1 ? p.rootOperator : p.childOperator) && q.payee == (g.depth == 1 ? p.rootPayee : p.childPayee),"allowlist");
        require(q.fee > 0 && q.fee <= (g.depth == 1 ? p.rootFeeMax : p.perChildMax) && q.fee <= g.free,"fee");
        require(q.expiry > block.timestamp && q.expiry <= p.expiry,"quote expiry");
        bytes32 digest = quoteDigest(q); require(_recover(digest,sig) == q.operator,"signature");
        g.free -= q.fee; g.held += q.fee;
        offers[q.grantId] = Offer(OfferState.Offered,q.operator,q.payee,q.fee,q.expiry,digest);
        emit Reserved(q.grantId,offerId(q.grantId),digest,q.fee);
    }
    function accept(bytes32 id) external {
        Grant storage g = grants[id]; Offer storage o = offers[id]; _active(g.rootId);
        require(o.state == OfferState.Offered && block.timestamp < o.expiry,"offer");
        require(msg.sender == o.operator,"operator");
        g.held -= o.fee; g.providerUnclaimed += o.fee; o.state = OfferState.Accepted;
        emit Accepted(id,o.payee,o.fee);
    }
    function cancel(bytes32 id) external {
        Policy storage p = policies[grants[id].rootId];
        require(msg.sender == p.owner || msg.sender == p.delegate,"cancel authority");
        _release(id,OfferState.Cancelled);
    }
    function release(bytes32 id) external {
        Grant storage g = grants[id]; Offer storage o = offers[id];
        require(closing[g.rootId] || block.timestamp >= policies[g.rootId].expiry || block.timestamp >= o.expiry,"not releasable");
        _release(id, block.timestamp >= o.expiry ? OfferState.Expired : OfferState.Cancelled);
    }
    function _release(bytes32 id, OfferState s) internal {
        Offer storage o = offers[id]; require(o.state == OfferState.Offered,"offer");
        Grant storage g = grants[id]; g.held -= o.fee; g.free += o.fee; o.state = s;
        emit Released(id,s);
    }
    function split(bytes32 root, uint256[] calldata allocations) external {
        Grant storage g = grants[root]; Policy storage p = policies[root]; _active(root);
        require(g.depth == 1 && msg.sender == p.delegate,"root/delegate");
        require(offers[root].state == OfferState.Accepted && !didSplit[root],"split state");
        require(allocations.length > 0 && allocations.length <= 2,"count");
        uint256 total;
        for(uint256 i; i<allocations.length; i++) { require(allocations[i] > 0 && allocations[i] <= p.perChildMax,"allocation"); total += allocations[i]; }
        require(total <= p.childrenTotalMax && total <= g.free,"total");
        didSplit[root] = true; childCount[root] = uint8(allocations.length); g.free -= total; g.delegatedOutstanding += total;
        for(uint256 i; i<allocations.length; i++) { bytes32 id = childId(root,i); grants[id] = Grant(root,allocations[i],allocations[i],0,0,0,0,0,2); }
        emit Split(root,allocations.length,total);
    }
    function close(bytes32 root) external { require(grants[root].depth == 1 && msg.sender == policies[root].owner,"owner"); closing[root] = true; emit Closed(root); }
    function withdraw(bytes32 id) external nonReentrant {
        Grant storage g = grants[id]; Policy storage p = policies[g.rootId];
        require(msg.sender == p.owner && g.depth != 0,"owner");
        require(closing[g.rootId] || block.timestamp >= p.expiry,"active");
        uint256 amount = g.free; require(amount > 0,"empty"); g.free = 0; g.ownerWithdrawn += amount; paidOut += amount;
        (bool ok,) = p.owner.call{value:amount}(""); require(ok,"transfer"); emit Withdrawn(id,p.owner,amount);
    }
    function claim(bytes32 id) external nonReentrant {
        Grant storage g = grants[id]; Offer storage o = offers[id]; require(o.state == OfferState.Accepted,"accepted");
        uint256 amount = g.providerUnclaimed; require(amount > 0,"empty"); g.providerUnclaimed = 0; g.providerClaimed += amount; paidOut += amount;
        (bool ok,) = o.payee.call{value:amount}(""); require(ok,"transfer"); emit Claimed(id,o.payee,amount);
    }
    function ledgerValid(bytes32 id) public view returns(bool) { Grant storage g=grants[id]; return g.depth != 0 && g.originalAllocation == g.free+g.held+g.providerUnclaimed+g.providerClaimed+g.ownerWithdrawn+g.delegatedOutstanding; }
    function accountedBalance() public view returns(uint256) { return registeredFunding-paidOut; }
    function unsolicitedSurplus() external view returns(uint256) { return address(this).balance-accountedBalance(); }
    function _recover(bytes32 h, bytes calldata sig) internal pure returns(address signer) {
        require(sig.length == 65,"signature length"); bytes32 r; bytes32 s; uint8 v;
        assembly { r := calldataload(sig.offset) s := calldataload(add(sig.offset,32)) v := byte(0,calldataload(add(sig.offset,64))) }
        require(uint256(s) <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0 && (v==27 || v==28),"signature canonical");
        signer=ecrecover(h,v,r,s); require(signer != address(0),"signature zero");
    }
}
