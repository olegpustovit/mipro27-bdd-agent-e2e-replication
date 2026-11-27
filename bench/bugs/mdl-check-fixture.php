<?php
// Seed the independent checks in a disposable Moodle worker.
define('BEHAT_UTIL', true);
define('CLI_SCRIPT', true);
define('NO_OUTPUT_BUFFERING', true);
require('/var/www/html/config.php');
require_once($CFG->dirroot . '/lib/testing/generator/lib.php');

[$scenario] = array_slice($argv, 1);
$generator = new testing_data_generator();
$result = [];
$banner = 'The search currently only finds frog-related content; we hope to fix it soon.';

if (in_array($scenario, ['S027', 'S028', 'S029'])) {
    set_config('enableglobalsearch', 1);
    set_config('searchengine', 'simpledb');
    set_config('searchbannerenable', $scenario !== 'S028' ? 1 : 0);
    set_config('searchbanner', $scenario === 'S029' ? '' : $banner);
} else {
    set_config('enablecompletion', 1);
    $teacher = $generator->create_user([
        'username' => 'teacher1', 'firstname' => 'Teacher', 'lastname' => 'One',
        'password' => 'teacher1',
    ]);
    $student = $generator->create_user(['username' => 'student1', 'password' => 'student1']);
    $courseoptions = [
        'fullname' => 'Course 1', 'shortname' => 'C1',
        'enablecompletion' => 1, 'showcompletionconditions' => 1,
    ];
    if ($scenario === 'S040') {
        $courseoptions['numsections'] = 1;
    }
    $course = $generator->create_course($courseoptions);
    $generator->enrol_user($teacher->id, $course->id, 'editingteacher');
    $generator->enrol_user($student->id, $course->id, 'student');
    $result['course'] = $course->id;
    if (in_array($scenario, ['S036', 'S037'])) {
        $manual = $generator->create_module('choice', [
            'course' => $course->id, 'name' => 'Test choice manual', 'completion' => 1,
        ]);
        $automatic = $generator->create_module('choice', [
            'course' => $course->id, 'name' => 'Test choice auto', 'completion' => 2, 'completionsubmit' => 1,
        ]);
        $result['cm'] = $manual->cmid;
        $result['automaticcm'] = $automatic->cmid;
    } else if (in_array($scenario, ['S040', 'S041'])) {
        $assignmentoptions = [
            'course' => $course->id, 'name' => 'Music history', 'completion' => 1,
        ];
        if ($scenario === 'S040') {
            $assignmentoptions['section'] = 1;
        }
        $assign = $generator->create_module('assign', $assignmentoptions);
        $result['cm'] = $assign->cmid;
        $result['student'] = $student->id;
    } else if (in_array($scenario, ['S042', 'S043', 'S044', 'S045', 'S046', 'S047'])) {
        require_once($CFG->dirroot . '/mod/quiz/locallib.php');
        $quiz = $generator->create_module('quiz', [
            'course' => $course->id, 'name' => 'Quiz 1', 'questionsperpage' => 0, 'navmethod' => 'sequential',
        ]);
        $bank = $generator->get_plugin_generator('core_question');
        $category = $bank->create_question_category(['contextid' => context_module::instance($quiz->cmid)->id]);
        $count = match ($scenario) {
            'S044' => 10,
            'S045', 'S046' => 9,
            default => 3,
        };
        for ($i = 1; $i <= $count; $i++) {
            $name = match ($scenario) {
                'S042', 'S043' => 'Question ' . chr(64 + $i),
                'S047' => 'TF' . $i,
                default => "Question{$i} text",
            };
            $question = $bank->create_question('truefalse', null, [
                'category' => $category->id,
                'name' => $name,
                'questiontext' => ['text' => $name, 'format' => FORMAT_HTML],
            ]);
            quiz_add_quiz_question($question->id, $quiz, $count === 3 && $i === 3 ? 2 : 1);
        }
        \mod_quiz\quiz_settings::create($quiz->id)->get_grade_calculator()->recompute_quiz_sumgrades();
        $result['cm'] = $quiz->cmid;
    } else if ($scenario === 'S093') {
        set_config('enableaccessibilitytools', 1);
        set_config('analysistype', 1, 'tool_brickfield');
    }
}
echo json_encode($result, JSON_THROW_ON_ERROR);
