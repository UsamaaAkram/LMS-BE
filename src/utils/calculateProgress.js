// utils/calculateProgress.js
function calculateProgress(progress) {
  // Videos (40%)
  const lessonWatchedArr = progress.lessonWatched || [];
  const totalVideos = lessonWatchedArr.length;

  let totalWatchedPercent = 0;
  lessonWatchedArr.forEach((lw) => {
    if (lw.videoTime && lw.presentWatch != null) {
      // Prevent weird results if presentWatch > videoTime
      let percent = lw.presentWatch / lw.videoTime;
      if (percent > 1) percent = 1;
      totalWatchedPercent += percent;
    }
  });

  // If no videos, videoScore = 0
  // Otherwise, average percent watched across all, scaled to 40 marks
  const videoScore =
    totalVideos !== 0 ? (totalWatchedPercent / totalVideos) * 40 : 0;

  // Assignments (10%)
  const totalAssignments = (progress.assignments || []).length;
  const submittedAssignments = (progress.assignments || []).filter(
    (a) => a.isSubmitted
  ).length;
  const assignmentScore = totalAssignments
    ? (submittedAssignments / totalAssignments) * 10
    : 0;

  // Quizzes (50%)
  const quizzes = progress.quizzes || [];
  const totalQuizMarks = quizzes.reduce(
    (acc, q) => acc + (q.totalMarks || 0),
    0
  );
  const studentQuizMarks = quizzes.reduce((acc, q) => acc + (q.marks || 0), 0);
  const quizScore = totalQuizMarks
    ? (studentQuizMarks / totalQuizMarks) * 50
    : 0;

  // Grand total
  const grandTotal = videoScore + assignmentScore + quizScore;
  const grade = getGradeFromTotal(grandTotal);

  return {
    videoScore: +videoScore.toFixed(2),
    assignmentScore: +assignmentScore.toFixed(2),
    quizScore: +quizScore.toFixed(2),
    grandTotal: +grandTotal.toFixed(2),
    grade,
  };
}

function getGradeFromTotal(total) {
  if (total >= 90) return "A+";
  if (total >= 80) return "A";
  if (total >= 70) return "B";
  if (total >= 60) return "C";
  if (total >= 50) return "D";
  if (total >= 40) return "E";
  return "F";
}
module.exports = calculateProgress;
