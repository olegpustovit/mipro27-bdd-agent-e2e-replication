<?php
// Study step-log extension for Behat 3 (loaded by path from a config that imports Moodle's behat.yml).
// Writes one JSON line per scenario to $STUDY_STEP_LOG: every executed step (Background included)
// with its 0-based index, keyword, text, line, status, duration and failure message.
// It only observes events; it changes no behaviour and is not part of the Moodle repository.

use Behat\Behat\EventDispatcher\Event\AfterScenarioTested;
use Behat\Behat\EventDispatcher\Event\AfterStepTested;
use Behat\Behat\EventDispatcher\Event\BeforeScenarioTested;
use Behat\Behat\EventDispatcher\Event\BeforeStepTested;
use Behat\Behat\Tester\Result\StepResult;
use Behat\Testwork\EventDispatcher\ServiceContainer\EventDispatcherExtension;
use Behat\Testwork\ServiceContainer\Extension;
use Behat\Testwork\ServiceContainer\ExtensionManager;
use Behat\Testwork\Tester\Result\ExceptionResult;
use Symfony\Component\Config\Definition\Builder\ArrayNodeDefinition;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Definition;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

final class StudyStepLogSubscriber implements EventSubscriberInterface {
    private array $steps = [];
    private ?float $began = null;
    private ?float $scenariobegan = null;

    public static function getSubscribedEvents(): array {
        return [
            BeforeScenarioTested::BEFORE => 'beforeScenario',
            // Scenario Outline rows are dispatched under their own event names (same event classes): log them too.
            'tester.example_tested.before' => 'beforeScenario',
            BeforeStepTested::BEFORE => 'beforeStep',
            AfterStepTested::AFTER => 'afterStep',
            AfterScenarioTested::AFTER => 'afterScenario',
            'tester.example_tested.after' => 'afterScenario',
        ];
    }

    public function beforeScenario(BeforeScenarioTested $event): void {
        $this->steps = [];
        $this->scenariobegan = microtime(true);
    }

    public function beforeStep(BeforeStepTested $event): void {
        $this->began = microtime(true);
    }

    public function afterStep(AfterStepTested $event): void {
        $result = $event->getTestResult();
        $status = match (true) {
            $result->getResultCode() === StepResult::UNDEFINED => 'undefined',
            $result->getResultCode() === StepResult::PENDING => 'pending',
            $result->getResultCode() === StepResult::SKIPPED => 'skipped',
            $result->isPassed() => 'passed',
            default => 'failed',
        };
        $error = null;
        if ($result instanceof ExceptionResult && $result->hasException()) {
            $error = substr(get_class($result->getException()) . ': ' . $result->getException()->getMessage(), 0, 4000);
        }
        $definition = null;
        if ($result instanceof \Behat\Behat\Tester\Result\DefinedStepResult && $result->getStepDefinition()) {
            $definition = $result->getStepDefinition()->getPath();   // e.g. behat_search::i_search_for_...()
        }
        $step = $event->getStep();
        $background = $event->getFeature()->getBackground();
        $inbackground = false;
        if ($background) {
            foreach ($background->getSteps() as $bgstep) {
                if ($bgstep->getLine() === $step->getLine()) {
                    $inbackground = true;
                }
            }
        }
        $this->steps[] = [
            'index' => count($this->steps),
            'keyword' => trim($step->getKeyword()),
            'text' => $step->getText(),
            'line' => $step->getLine(),
            'background' => $inbackground,
            'status' => $status,
            'definition' => $definition,
            'ms' => $this->began === null ? null : (int) round((microtime(true) - $this->began) * 1000),
            'error' => $error,
        ];
    }

    public function afterScenario(AfterScenarioTested $event): void {
        $path = getenv('STUDY_STEP_LOG');
        if (!$path) {
            return;
        }
        $scenario = $event->getScenario();
        $record = [
            'feature' => $event->getFeature()->getFile(),
            'name' => $scenario->getTitle(),
            'line' => $scenario->getLine(),
            'tags' => $scenario->getTags(),
            'status' => $event->getTestResult()->isPassed() ? 'passed' : 'failed',
            'ms' => (int) round((microtime(true) - $this->scenariobegan) * 1000),
            'steps' => $this->steps,
        ];
        file_put_contents($path, json_encode($record, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);
    }
}

final class StudyStepLogExtension implements Extension {
    public function getConfigKey(): string {
        return 'study_steplog';
    }
    public function initialize(ExtensionManager $extensionManager): void {
    }
    public function configure(ArrayNodeDefinition $builder): void {
    }
    public function load(ContainerBuilder $container, array $config): void {
        $definition = new Definition(StudyStepLogSubscriber::class);
        $definition->addTag(EventDispatcherExtension::SUBSCRIBER_TAG);
        $container->setDefinition('study.steplog', $definition);
    }
    public function process(ContainerBuilder $container): void {
    }
}

return new StudyStepLogExtension();
