// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Crowdfunding sin intermediarios
/// @notice Los fondos quedan bloqueados hasta meta o plazo
/// @dev Un contrato por campaña para simplificar la lógica
contract Crowdfunding {
    // ===== Errores personalizados (gas-eficientes) =====
    error NotCreator();
    error AfterDeadline();
    error BeforeDeadline();
    error GoalNotReached();
    error GoalAlreadyReached();
    error ZeroContribution();
    error NothingToRefund();
    error AlreadyWithdrawn();

    // ===== Eventos =====
    event ContributionReceived(address indexed contributor, uint256 amount, uint256 newTotal);
    event FundsWithdrawn(address indexed creator, uint256 amount);
    event RefundClaimed(address indexed contributor, uint256 amount);

    // ===== Estado =====
    address public immutable creator;
    uint256 public immutable targetAmount; // en wei
    uint256 public immutable deadline;     // timestamp UNIX (segundos)
    uint256 public totalRaised;
    bool public fundsWithdrawn;

    mapping(address => uint256) public contributions;

    // ===== Modificadores =====
    modifier onlyCreator() {
        if (msg.sender != creator) revert NotCreator();
        _;
    }

    modifier beforeDeadline() {
        if (block.timestamp >= deadline) revert AfterDeadline();
        _;
    }

    modifier afterDeadline() {
        if (block.timestamp < deadline) revert BeforeDeadline();
        _;
    }

    constructor(uint256 _targetAmount, uint256 _deadlineTimestamp) {
        require(_targetAmount > 0, "Target must be > 0");
        require(_deadlineTimestamp > block.timestamp, "Deadline must be in the future");
        creator = msg.sender;
        targetAmount = _targetAmount;
        deadline = _deadlineTimestamp;
    }

    // ===== Lógica =====

    /// @notice Aporta ETH a la campaña antes de la fecha límite
    function contribute() external payable beforeDeadline {
        if (msg.value == 0) revert ZeroContribution();
        contributions[msg.sender] += msg.value;
        totalRaised += msg.value;
        emit ContributionReceived(msg.sender, msg.value, totalRaised);
    }

    /// @notice El creador retira los fondos si se alcanzó la meta al finalizar el plazo
    function withdrawFunds() external onlyCreator afterDeadline {
        if (totalRaised < targetAmount) revert GoalNotReached();
        if (fundsWithdrawn) revert AlreadyWithdrawn();

        fundsWithdrawn = true; // effects
        uint256 amount = address(this).balance;

        // interaction
        (bool ok, ) = payable(creator).call{value: amount}("");
        require(ok, "Transfer failed");

        emit FundsWithdrawn(creator, amount);
    }

    /// @notice Reembolso al aportante si no se alcanzó la meta al finalizar el plazo
    function claimRefund() external afterDeadline {
        if (totalRaised >= targetAmount) revert GoalAlreadyReached();
        uint256 contributed = contributions[msg.sender];
        if (contributed == 0) revert NothingToRefund();

        contributions[msg.sender] = 0; // effects

        // interaction
        (bool ok, ) = payable(msg.sender).call{value: contributed}("");
        require(ok, "Refund transfer failed");

        emit RefundClaimed(msg.sender, contributed);
    }

    // ===== Lecturas de conveniencia =====

    function goalReached() external view returns (bool) {
        return totalRaised >= targetAmount;
    }

    function timeLeft() external view returns (uint256) {
        if (block.timestamp >= deadline) return 0;
        return deadline - block.timestamp;
    }
}
