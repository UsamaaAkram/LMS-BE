function getGradeFromTotal(total) {
  if (total >= 90) return "A+";
  if (total >= 80) return "A";
  if (total >= 70) return "B";
  if (total >= 60) return "C";
  if (total >= 50) return "D";
  if (total >= 40) return "E";
  return "F";
}

function getCourseActualProgress(progress) {
  // VIDEO
  const lessonWatchedArr = progress.lessonWatched || [];
  const totalVideos = lessonWatchedArr.length;
  let totalWatchedPercent = 0;
  lessonWatchedArr.forEach((lw) => {
    if (lw.videoTime && lw.presentWatch != null) {
      let percent = lw.presentWatch / lw.videoTime;
      if (percent > 1) percent = 1;
      totalWatchedPercent += percent;
    }
  });
  const videoMarks = totalVideos !== 0 ? (totalWatchedPercent / totalVideos) * 40 : 0;
  const videoProgress = totalVideos !== 0 ? (totalWatchedPercent / totalVideos) * 100 : 0;

  // ASSIGNMENTS
  const totalAssignments = (progress.assignments || []).length;
  const submittedAssignments = (progress.assignments || []).filter((a) => a.isSubmitted).length;
  const assignmentMarks = totalAssignments ? (submittedAssignments / totalAssignments) * 10 : 0;
  const assignmentProgress = totalAssignments ? (submittedAssignments / totalAssignments) * 100 : 0;

  // QUIZZES
  const quizzes = progress.quizzes || [];
  const totalQuizMarks = quizzes.reduce((acc, q) => acc + (q.totalMarks || 0), 0);
  const studentQuizMarks = quizzes.reduce((acc, q) => acc + (q.marks || 0), 0);
  const quizMarks = totalQuizMarks ? (studentQuizMarks / totalQuizMarks) * 50 : 0;
  const quizProgress = totalQuizMarks ? (studentQuizMarks / totalQuizMarks) * 100 : 0;

  // GRAND TOTAL & GRADE
  const grandTotal = videoMarks + assignmentMarks + quizMarks;
  const grade = getGradeFromTotal(grandTotal);

  // For easy UI rendering as in your screenshot
  return {
    videoProgress: +videoProgress.toFixed(2),
    assignmentProgress: +assignmentProgress.toFixed(2),
    quizProgress: +quizProgress.toFixed(2),
    videoMarks: +videoMarks.toFixed(2),
    assignmentMarks: +assignmentMarks.toFixed(2),
    quizMarks: +quizMarks.toFixed(2),
    grad: grade,
    grandTotal: +grandTotal.toFixed(2),
    courseProgress: +(grandTotal).toFixed(2) // or replace with percent logic if different from marks
  };
}

module.exports = getCourseActualProgress;