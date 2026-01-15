export function createEmailTemplate(
    candidateName,
    companyName,
    interviewerName,
    roundNumber,
    calendlyLink
) {
    return `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif;">
    <h2>Interview Invitation</h2>

    <p>Dear ${candidateName},</p>

    <p>
        We are pleased to invite you for an interview with
        <strong>${companyName}</strong>.
    </p>

    <ul>
        <li><strong>Round:</strong> ${roundNumber}</li>
        <li><strong>Interviewer:</strong> ${interviewerName}</li>
    </ul>

    <p>
        <a href="${calendlyLink}"
           style="padding:12px 20px; background:#007bff; color:#fff; text-decoration:none;">
           Schedule Interview
        </a>
    </p>

    <p>Best regards,<br/>Weekday Team</p>
</body>
</html>
`;
}
