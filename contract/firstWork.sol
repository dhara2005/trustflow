// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.3;

contract Ownable{

    address public owner;

    constructor () {
        owner = msg.sender;
    }

    modifier ownerOnly (){

        require (msg.sender == owner, "only owner can call this contract");

        _;
    }

    function transferOwnership (address newOwner) external ownerOnly{

        require (newOwner != address(0), "address can't be a zero address");

        owner = newOwner;
    }
}

contract Pausable is Ownable{

    bool public isItPaused;

    modifier isPaused () {

        require (isItPaused == false, "the contract is paused");
        _;
    }

    function Pause () external ownerOnly{

        isItPaused = true;
    }

    function unPause () external ownerOnly{
        
        isItPaused  = false;
    }

    
}

contract escrow is Ownable, Pausable {

    uint public platformFee = 5; 
    uint public platformEarnings; 
    uint public escrowCounter;

    enum Status {
           Open,
           InProgress,
           Completed,
           Disputed,
           Released,
           Cancelled
        }

    struct data{

        uint escrowId;
        address employer;
        address employee;
        string jobDesc;
        uint amount;
        Status status;
        uint timestamp;
    }

    mapping (uint => data) Escrow;
    mapping (address => uint[]) client;
    mapping (address => uint[]) freelancer;
    mapping (address => uint) earnings;


    modifier freelancerOnly (uint _escrowId){

        require (Escrow[_escrowId].employee == msg.sender , "not the freelancer for the job");

        _;
    }

    modifier clientOnly (uint _escrowId){
        
        require (Escrow[_escrowId].employer == msg.sender , "not the client of this job");

        _;
    }


    modifier escrowExist (uint _escrowId){

        require (_escrowId > 0 && _escrowId <= escrowCounter, "escrow id does not exist");

        _;
    }

    event escrowCreated (uint indexed escrowId, address indexed client , address indexed freelancer, string jobDescription, uint amount );

    event escrowAccepted (uint indexed escrowId, address indexed freelancer);

    event workSubmitted (uint indexed escrowId , address indexed freelancer);

    event paymentReleased (uint indexed escrowId , address indexed client, uint freelancerEarnings , uint platformEarnings);

    event escrowDisputed (uint indexed escrowId , address indexed by);

    event disputeResolved (uint indexed escrowId, bool releasedtoFreelancer);

    event escrowCancelled (uint indexed escrowId , address indexed client);

    event earningsWithdrawn (address indexed freelancer, uint amount);

    event platformFeeWithdrawn (uint amount);

    event feesChanged (uint oldFee , uint newFee);

    function createEscrow (string memory description, address _freelancer) external payable isPaused returns(uint){

        require (bytes(description).length > 10, "minimum of 10 character to proceed");
        require (_freelancer != address(0) , "address can't be the default address");
        require (_freelancer != msg.sender ,"freelancer can't be the client");
        require (msg.value > 0 , "you can't have 0 amount");

        escrowCounter++;


        Escrow[escrowCounter] = data ({

            escrowId : escrowCounter,
            employer : msg.sender,
            employee : _freelancer,
            jobDesc: description,
            amount : msg.value,
            status : Status.Open,
            timestamp : block.timestamp
        });

        client[msg.sender].push(escrowCounter);
        freelancer [_freelancer].push(escrowCounter);

        emit escrowCreated (escrowCounter , msg.sender , _freelancer , description , msg.value);

        return escrowCounter;
    }


    function acceptEscrow (uint _escrowId) external isPaused freelancerOnly(_escrowId) escrowExist(_escrowId){

        require (Escrow[_escrowId].status == Status.Open ,"job not opened yet");

        Escrow[_escrowId].status = Status.InProgress;

        emit escrowAccepted (_escrowId , msg.sender);
    }


    function submitWork (uint _escrowId) external isPaused freelancerOnly(_escrowId) escrowExist(_escrowId){

        require (Escrow[_escrowId].status == Status.InProgress , "Job has to be in progress");

        Escrow[_escrowId].status = Status.Completed;

        emit workSubmitted (_escrowId, msg.sender);
    }


    function approveAndRelease (uint _escrowId) external isPaused clientOnly(_escrowId) escrowExist(_escrowId){

        require ( Escrow[_escrowId].status == Status.Completed, "job has to be completed");

        uint fee = Escrow[_escrowId].amount * platformFee / 100;

        uint freelancerPayment = Escrow[_escrowId].amount - fee;

        platformEarnings += fee;

        earnings[Escrow[_escrowId].employee] += freelancerPayment;

        Escrow[_escrowId].status = Status.Released;

        emit paymentReleased (_escrowId , msg.sender , freelancerPayment , fee);
    }


    function dispute (uint _escrowId) external isPaused escrowExist(_escrowId){

        require (Escrow[_escrowId].employer == msg.sender || Escrow[_escrowId].employee == msg.sender, "client or freelancer only");
        require (Escrow[_escrowId].status == Status.InProgress || Escrow[_escrowId].status == Status.Completed , "Job must be in progress or completed");

        Escrow[_escrowId].status = Status.Disputed;

        emit escrowDisputed (_escrowId , msg.sender);
    }


    function resolveDispute (uint _escrowId, bool releaseToFreelancer) 

        external 
            isPaused 
                ownerOnly 
                    escrowExist (_escrowId)
                    {
                         require (Escrow[_escrowId].status == Status.Disputed, "job has to be disputed");

                                if (releaseToFreelancer){
                                    
                                    uint fee = Escrow[_escrowId].amount * platformFee / 100;

                                        uint freelancerPayment = Escrow[_escrowId].amount - fee;

                                        platformEarnings += fee;

                                        earnings[Escrow[_escrowId].employee] += freelancerPayment;

                                        Escrow[_escrowId].status = Status.Released;

                                }

                                else {
                                            
                                    uint _amount = Escrow[_escrowId].amount;

                                    address _client = Escrow[_escrowId].employer;

                                    payable(_client).transfer(_amount);

                                    Escrow[_escrowId].status = Status.Cancelled;
                                    }

                                        emit disputeResolved(_escrowId, releaseToFreelancer);
                                    }


    function cancelEscrow (uint _escrowId) external isPaused clientOnly(_escrowId) escrowExist(_escrowId){

        require (Escrow[_escrowId].status == Status.Open, "once job is accepted it can't be cancelled");

        uint _amount = Escrow[_escrowId].amount;

        payable(msg.sender).transfer(_amount);

        Escrow[_escrowId].status = Status.Cancelled;

        emit escrowCancelled (_escrowId , msg.sender);
    }


    function withdrawEarnings () external isPaused {

        require (earnings[msg.sender] > 0, "freelancer has no balance");

        uint _amount = earnings[msg.sender];

        payable (msg.sender).transfer(_amount);

        earnings[msg.sender] = 0;

        emit earningsWithdrawn (msg.sender, _amount);
    } 


    function withdrawPlatformFee () external isPaused ownerOnly{

        require (platformEarnings > 0 , "no earnings yet");

        uint fee = platformEarnings;

        payable(owner).transfer(platformEarnings);

        platformEarnings = 0;

        emit platformFeeWithdrawn (fee);
    }

    function getEscrow (uint _escrowId) external view isPaused escrowExist(_escrowId) returns (data memory){

        return Escrow[_escrowId];
    }

    function getMyClientEscrows () external view isPaused returns (uint [] memory){

        return client[msg.sender];
    }

    function getMyFreelancerEscrows () external view isPaused returns(uint [] memory){

        return freelancer[msg.sender];
    }

    function getMyEarnings () external view isPaused returns(uint){

        return earnings[msg.sender];
    }


    function changeFee (uint _newFee) external isPaused ownerOnly{

        require (_newFee > 0 && _newFee <= 10, "fee range must be between 0 to 10%");

        uint _oldFee = platformFee;

        platformFee = _newFee;

        emit feesChanged (_oldFee , _newFee);
    }
}