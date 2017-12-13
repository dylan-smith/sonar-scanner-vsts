const path = require('path');
const decompress = require('gulp-decompress');
const del = require('del');
const download = require('gulp-download');
const gulp = require('gulp');
const gulpif = require('gulp-if');
const gulpSequence = require('gulp-sequence');
const gutil = require('gulp-util');
const jeditor = require('gulp-json-editor');
const rename = require('gulp-rename');
const { argv } = require('yargs');
const es = require('event-stream');
const fs = require('fs-extra');
const semver = require('semver');
const extensionTest = require('./vss-extension.test.json');
const { bundleTsTask, pathAllFiles, npmInstallTask, tfxCommand } = require('./package-utils');

const paths = {
  build: {
    root: 'build',
    extension: path.join('build', 'sonarqube'),
    tasks: path.join('build', 'sonarqube', 'tasks'),
    oldTasks: path.join('build', 'sonarqube', 'oldTasks'),
    tmp: path.join('build', 'tmp'),
    scanner: path.join('build', 'tmp', 'scanner-msbuild')
  },
  common: 'common',
  tasks: 'tasks',
  oldTasks: 'oldTasks',
};

const sqScannerMSBuildVersion = '3.0.2.656';
const sqScannerCliVersion = '3.0.3.778'; // Has to be the same version as the one embedded in the Scanner for MSBuild
const sqScannerUrl = `https://github.com/SonarSource/sonar-scanner-msbuild/releases/download/${sqScannerMSBuildVersion}/sonar-scanner-msbuild-${sqScannerMSBuildVersion}.zip`;

gulp.task('clean', () => del([path.join(paths.build.root, '**'), '*.vsix']));

gulp.task('scanner:download', () =>
  download(sqScannerUrl)
    .pipe(decompress())
    .pipe(gulp.dest(paths.build.scanner))
);

gulp.task('scanner:copy', ['scanner:download'], () =>
  es.merge(
    gulp
      .src(pathAllFiles(paths.build.scanner))
      .pipe(
        gulp.dest(
          path.join(paths.build.oldTasks, 'scanner-msbuild-begin', 'SonarQubeScannerMsBuild')
        )
      )
      .pipe(
        gulp.dest(
          path.join(paths.build.tasks, 'prepare', 'sonar-scanner-msbuild')
        )
      ),
    gulp
      .src(pathAllFiles(paths.build.scanner, `sonar-scanner-${sqScannerCliVersion}`))
      .pipe(gulp.dest(path.join(paths.build.oldTasks, 'scanner-cli', 'sonar-scanner')))
      .pipe(gulp.dest(path.join(paths.build.tasks, 'analyze', 'sonar-scanner')))
  )
);

gulp.task('tasks:old:copy', () =>
  gulp
    .src(pathAllFiles(paths.oldTasks, '**'))
    .pipe(
      gulpif(
        file => file.path.endsWith('task.json'),
        jeditor(task => ({
          ...task,
          helpMarkDown:
            `Version: ${task.version.Major}.${task.version.Minor}.${task.version.Patch}. ` +
            task.helpMarkDown
        }))
      )
    )
    .pipe(gulp.dest(paths.build.oldTasks))
);

gulp.task('tasks:old:common', () => {
  let commonPipe = gulp.src(pathAllFiles(paths.common, 'powershell'));
  let logoPipe = gulp.src(path.join('logos', 'icon.png'));
  fs.readdirSync(paths.oldTasks)
    .forEach(dir => {
      commonPipe = commonPipe.pipe(gulp.dest(path.join(paths.build.oldTasks, dir)));
      logoPipe = logoPipe.pipe(gulp.dest(path.join(paths.build.oldTasks, dir)));
  });
  return es.merge(commonPipe, logoPipe);
});

gulp.task('tasks:new:npminstall', () => {
  gulp
    .src([path.join(paths.tasks, '**', 'package.json'), '!**/node_modules/**'])
    .pipe(es.mapSync(file => npmInstallTask(file.path)));
});

gulp.task('tasks:new:copy', () =>
  gulp
    .src([path.join(paths.tasks, '**', 'task.json'), path.join(paths.tasks, '**', '*.png')])
    .pipe(gulp.dest(paths.build.tasks))
);

gulp.task('tasks:new:bundle', ['tasks:new:npminstall'], () =>
  gulp.src([path.join(paths.tasks, '**', '*.ts'), '!**/node_modules/**']).pipe(
    es.mapSync(file => {
      const filePath = path.parse(file.path);
      return bundleTsTask(
        file.path,
        path.join(paths.build.extension, filePath.dir.replace(__dirname, ''), filePath.name + '.js')
      );
    })
  )
);

gulp.task('tasks:version', () => {
  if (!argv.releaseVersion) {
    return Promise.resolve();
  }

  const version = {
    Major: semver.major(argv.releaseVersion),
    Minor: semver.minor(argv.releaseVersion),
    Patch: semver.patch(argv.releaseVersion)
  };

  return gulp
    .src(path.join(paths.build.tasks, '**', 'task.json'))
    .pipe(
      jeditor({
        version,
        helpMarkDown: `Version: ${version}. [More Information](http://redirect.sonarsource.com/doc/install-configure-scanner-tfs-ts.html)`
      })
    )
    .pipe(gulp.dest(paths.build.tasks));
});

gulp.task('tasks:old:test', () => {
  const dirs = fs.readdirSync(paths.oldTasks);
  let taskPipe = gulp.src(path.join('logos', 'icon.test.png')).pipe(rename('icon.png'));
  dirs.forEach(dir => {
    taskPipe = taskPipe.pipe(gulp.dest(path.join(paths.build.oldTasks, dir)));
  });
  return taskPipe;
});

gulp.task('tasks:test', () => {
  const dirs = fs.readdirSync(paths.tasks);
  let taskPipe = gulp.src(path.join('logos', 'icon.test.png')).pipe(rename('icon.png'));
  dirs.forEach(dir => {
    taskPipe = taskPipe.pipe(gulp.dest(path.join(paths.build.tasks, dir)));
  });
  return taskPipe;
});

gulp.task('extension:copy', () =>
  es.merge(
    gulp
      .src(['vss-extension.json', 'extension-icon.png', 'overview.md', 'license-terms.md'])
      .pipe(gulp.dest(paths.build.extension)),
    gulp.src(pathAllFiles('img')).pipe(gulp.dest(path.join(paths.build.extension, 'img'))),
    gulp.src(pathAllFiles('icons')).pipe(gulp.dest(path.join(paths.build.extension, 'icons')))
  )
);

gulp.task(
  'extension:version',
  () =>
    argv.releaseVersion
      ? gulp
          .src(path.join(paths.build.extension, 'vss-extension.json'))
          .pipe(jeditor({ version: argv.releaseVersion }))
          .pipe(gulp.dest(paths.build.extension))
      : Promise.resolve()
);

gulp.task('extension:test', () =>
  es.merge(
    gulp
      .src('extension-icon.test.png')
      .pipe(rename('extension-icon.png'))
      .pipe(gulp.dest(paths.build.extension)),
    gulp
      .src(path.join(paths.build.extension, 'vss-extension.json'))
      .pipe(jeditor(extensionTest))
      .pipe(gulp.dest(paths.build.extension))
  )
);

gulp.task('tfx', () => tfxCommand(paths.build.extension));

gulp.task('tfx:test', () =>
  tfxCommand(paths.build.extension, `--publisher ` + (argv.publisher || 'foo'))
);

gulp.task('copy', [
  'extension:copy',
  'tasks:old:copy',
  'tasks:old:common',
  'tasks:new:copy',
  'tasks:new:bundle',
  'scanner:copy'
]);

gulp.task('version', ['tasks:version', 'extension:version']);

gulp.task('test', ['extension:test', 'tasks:test', 'tasks:old:test']);

gulp.task('build', gulpSequence('clean', 'copy', 'version', 'tfx'));

gulp.task('build:test', gulpSequence('clean', 'copy', 'test', 'tfx:test'));

gulp.task('default', ['build']);