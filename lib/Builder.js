/*******************************************************************************
 *
 *  BUILDER.JS
 *
 *  Author: Brandon Eum
 *  Date: July 2013
 *
 ******************************************************************************/

/**
 * The builder is responsible for constructing the container and the definitions
 * based on the services.json files located anywhere within the application
 *
 *
 * @param {Object} fs Node file system library
 * @param {function} require The require function, injected so it can be mocked
 * @param {Container} Container The constructor for the container class
 * @param {Definition} Definition The constructor for the service Definition class
 * @returns {Builder} An instance of the container builder
 */
var Builder = function Builder(fs, require, Container, Definition) {
  this.options    = {
    env: false,
    ignoreNodeModulesDirectory: true
  };

  this.fs         = fs;
  this.require    = require;
  this.Container  = Container;
  this.Definition = Definition;
};

Builder.prototype.makeEmptyContainer = function (rootdirectory) {
  return new this.Container(this.require, rootdirectory);
};

/**
 * Looks for services.json files from the rootdirectory and below and constructs
 * a container based on the configurations it finds.
 *
 * @param {string} rootdirectory Absolute path for the root directory for this container
 * @param {Object} options Options for constructing the container
 * @returns {Container} An initialized container instance
 */
Builder.prototype.buildContainer = function (rootdirectory, options) {
  var container, files, i;

  // Set the options, or use the defaults
  this.options = options || this.options;

  // Construct a new Container
  container = this.makeEmptyContainer(rootdirectory);

  // Parse all of the service.json files and compile definitions
  files = this.findServiceJsonFiles(rootdirectory);
  files = this.sortFilesByHierarchy(files);

  // Ensure that we iterate in sorted order
  for (i = 0; i < files.length; i++) {
    this.parseFile(files[i], container);
  }

  return container;
};

/**
 * Returns a list of absolute paths to the JSON configuration files
 *
 * @param {string} absolutePath The absolute path to search
 * @param {integer} level The hierarchy level this file was found at
 * @returns {Array} An array of paths to the configuration filess
 */
Builder.prototype.findServiceJsonFiles = function (absolutePath, level) {
  var files, filepath, svcjsonfiles, i, stat, pattern, parameterPattern, envPattern;

  // Setup the pattern to find files
  pattern = new RegExp("services.json$");
  parameterPattern = new RegExp("parameters.json$");
  if (this.options.env) {
    envPattern = new RegExp("services_" + this.options.env + ".json$");
  } else {
    envPattern = null;
  }

  svcjsonfiles = [];
  files = this.fs.readdirSync(absolutePath);

  for (i in files) {
    filepath = absolutePath + '/' + files[i];
    stat = this.fs.statSync(filepath);

    // Recursively search for files - ignore the node modules directory
    if (stat.isDirectory() && (!this.options.ignoreNodeModulesDirectory || filepath.indexOf('node_modules') === -1)) {
      svcjsonfiles = svcjsonfiles.concat(this.findServiceJsonFiles(filepath, level + 1));
    } else if (stat.isFile()) {

      // Set the filepath, level, and isEnvFile flag for sorting in the right
      // order
      if (pattern.test(filepath)) {
        svcjsonfiles.push({file: filepath, dir: absolutePath, level: level, isEnvFile:false, isParamFile:false});
      } else if (parameterPattern.test(filepath)) {
        svcjsonfiles.push({file: filepath, dir: absolutePath, level: level, isEnvFile:false, isParamFile:true});
      } else if (envPattern && envPattern.test(filepath)) {
        svcjsonfiles.push({file: filepath, dir: absolutePath, level: level, isEnvFile:true, isParamFile:false});
      }
    }

    // Ignore files that do not match and are not directories
  }

  return svcjsonfiles;
};

/**
 * The rules for sorting are as follows
 *   - Parameter files are parsed last
 *   - Environment specific files are parsed second
 *   - Lower levels are parsed after higher levels
 *
 * @param {Array} files
 * @returns {Array}
 */
Builder.prototype.sortFilesByHierarchy = function (files) {
  var i, result, envFiles, nonEnvFiles, parameterFiles, sortFunc;
  envFiles    = [];
  nonEnvFiles = [];
  parameterFiles = [];
  for (i in files) {
    if (files[i].isEnvFile) {
      envFiles.push(files[i]);
    } else if (files[i].isParamFile) {
      parameterFiles.push(files[i]);
    } else {
      nonEnvFiles.push(files[i]);
    }
  }

  sortFunc = function (a, b) {
    // Lower levels are parsed later - Meaning that files higher in the app
    // structure take precedence over files lower in the file structure
    if (a.level < b.level) {
      return true;
    }

    // b was either an envFile or it had a lower level than a
    return false;
  };

  envFiles.sort(sortFunc);
  nonEnvFiles.sort(sortFunc);
  result = nonEnvFiles.concat(envFiles);
  result = result.concat(parameterFiles);

  return result;
};

/**
 * Takes a services.json file and creates service definitions or adds parameters
 * to the container instance being constructed.
 *
 * @param {Object} fileinfo An object with information about the file to parse
 * @param {Container} container The container instance to add services and parameters to
 * @param namespace
 * @returns {undefined}
 */
Builder.prototype.parseFile = function (fileinfo, container, namespace) {
  var i, importFile, file, path, config, serviceConfigs;
  var modifiedNs = '';

  namespace = namespace || '';

  // Get the config file
  if(fileinfo.config) {
    config = fileinfo.config;
  } else {
    config = this.require(fileinfo.file);
  }

  // Get the namespace if specified
  if (config.namespace) {
    namespace = (namespace && namespace !== '')
      ? namespace + '.' + config.namespace
      : config.namespace;;
  }

  modifiedNs = (namespace) ? namespace + '.' : '';

  // Import other JSON files before parsing this one
  for (i in config.imports) {
    // Transform the file path to be an absolute one, relative to this services.jso
    // file
    file = config.imports[i];
    file = file.replace(/^\.\.\//, './../');
    file = fileinfo.dir + file.replace('./', '/');
    path = file.replace(/\/[^/]+\.json$/, '');
    importFile = { file: file, dir: path, level: fileinfo.level };
    this.parseFile(importFile, container, namespace);
  }

  // Add the parameters with the right namespace
  for (i in config.parameters) {
    container.setParameter(modifiedNs + i, config.parameters[i]);
  }

  // Add service definitions if not a parameter file
  if (!fileinfo.isParamFile) {
    serviceConfigs = config.services;
    for (i in serviceConfigs) {

      container.set(
        modifiedNs + i,
        this.buildDefinition(serviceConfigs[i], fileinfo.dir, namespace)
      );
    }
  }
};

/**
 *
 * @param config
 * @param rootDirectory
 * @param namespace
 * @returns {Definition}
 */
Builder.prototype.buildDefinition = function (config, rootDirectory, namespace) {
  var definition;
  definition = new this.Definition();
  definition.file              = config.class;
  definition.rootDirectory     = rootDirectory;
  definition.constructorMethod = config.constructorMethod;
  definition.arguments         = config.arguments;
  definition.calls             = config.calls;
  definition.properties        = config.properties;
  definition.isObject          = config.isObject;
  definition.isFunction        = config.isFunction;
  definition.isSingleton       = (config.hasOwnProperty('isSingleton') ? config.isSingleton : true);
  definition.tags              = config.tags || [];
  definition.namespace         = namespace;
  return definition;
};

module.exports = Builder;