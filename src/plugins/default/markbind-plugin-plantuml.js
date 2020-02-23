/**
 * Parses PlantUML diagrams
 * Replaces <puml> tags with <pic> tags with the appropriate src attribute and generates the diagrams
 * by running the JAR executable
 */
const cheerio = module.parent.require('cheerio');
const fs = require('fs');
const path = require('path');
const cryptoJS = require('crypto-js');

const { exec } = require('child_process');
const logger = require('../../util/logger');
const fsUtil = require('../../util/fsUtil');

const JAR_PATH = path.resolve(__dirname, 'plantuml.jar');

const {
  ERR_PROCESSING,
  ERR_READING,
} = require('../../constants');

function fetchContentInTag(tag) {
  let content = '';
  if (tag.children !== undefined) {
    tag.children.forEach((child) => {
      if (child.type === 'text') {
        content = child.data;
      }
    });
  }

  return content;
}

function getFileName(tagAttribs, content) {
  if (tagAttribs.name !== undefined) {
    return `${tagAttribs.name}.png`;
  }

  if (tagAttribs.src !== undefined) {
    const fileName = fsUtil.removeExtension(tagAttribs.src);
    return `${fileName}.png`;
  }

  const hashedContent = cryptoJS.MD5(content).toString();
  return `${hashedContent}.png`;
}


function getContent(element, cwf, config) {
  const { sourcePath } = config;
  const _cwf = cwf || sourcePath;

  if (element.attribs.src !== undefined) {
    // Path of the .puml file
    const rawDiagramPath = path.resolve(path.dirname(_cwf), element.attribs.src);
    try {
      return fs.readFileSync(rawDiagramPath, 'utf8');
    } catch (err) {
      logger.debug(err);
      logger.error(`${ERR_READING} ${rawDiagramPath}`);
      return '';
    }
  }

  return fetchContentInTag(element);
}

// Tracks diagrams that have already been processed
const processedDiagrams = new Set();

/**
 * Generates diagram and returns the file name of the diagram
 * @param fileName name of the file to be generated
 * @param content puml dsl used to generate the puml diagram
 * @param config sourcePath and resultPath from parser context
 * @returns {string} file name of diagram
 */
function generateDiagram(fileName, content, config) {
  const { resultPath } = config;

  const outputDir = path.join(path.dirname(resultPath), path.dirname(fileName));
  // Path of the .puml file
  const outputFilePath = path.join(outputDir, path.basename(fileName));
  // Tracks built files to avoid accessing twice
  if (processedDiagrams.has(outputFilePath)) { return fileName; }
  processedDiagrams.add(outputFilePath);

  // Creates output dir if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Java command to launch PlantUML jar
  const cmd = `java -jar "${JAR_PATH}" -pipe > "${outputFilePath}"`;
  const childProcess = exec(cmd);

  let errorLog = '';
  childProcess.stdin.write(
    content,
    (e) => {
      if (e) {
        logger.debug(e);
        logger.error(`${ERR_PROCESSING} ${fileName}`);
      }
      childProcess.stdin.end();
    },
  );

  childProcess.on('error', (error) => {
    logger.debug(error);
    logger.error(`${ERR_PROCESSING} ${fileName}`);
  });

  childProcess.stderr.on('data', (errorMsg) => {
    errorLog += errorMsg;
  });

  childProcess.on('exit', () => {
    // This goes to the log file, but not shown on the console
    logger.debug(errorLog);
  });

  return fileName;
}

module.exports = {
  preRender: (content, pluginContext, frontmatter, config) => {
    // Clear <puml> tags processed before for live reload
    processedDiagrams.clear();
    // Processes all <puml> tags
    const $ = cheerio.load(content, { xmlMode: true });
    $('puml').each((i, tag) => {
      // eslint-disable-next-line no-param-reassign
      tag.name = 'pic';

      const { cwf } = tag.attribs;
      const pumlContent = getContent(tag, cwf, config);
      const fileName = getFileName(tag.attribs, pumlContent);

      // eslint-disable-next-line no-param-reassign
      tag.attribs.src = generateDiagram(fileName, pumlContent, config);
      tag.children = [];
    });

    return $.html();
  },
  getSources: () => ({
    tagMap: [['puml', 'src']],
  }),
};
