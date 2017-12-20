/*
A general Parallel Coordinates-based viewer for Spec-D cinema databases 

pcoord_viewer Version 1.4.1

Copyright 2017 Los Alamos National Laboratory 

Redistribution and use in source and binary forms, with or without 
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this 
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, 
   this list of conditions and the following disclaimer in the documentation 
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors 
   may be used to endorse or promote products derived from this software 
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND 
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED 
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE 
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE 
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL 
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR 
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER 
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, 
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE 
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

//Init variables
var databases;//An array of the databases (loaded from databases.json)
var currentDb;//The currently loaded database
var fileDimensions; //The FILE dimensions (if any)
var chart;//The Parallel Coordinates Chart
var currentResults = [];//The Array of selected results from the chart
var loaded = false;

var currentPage = 1;

//Vars concerning the user-defined path
var showingCustomControls = false;
var customPath = {};
var upperBoundPath = {};
var lowerBoundPath = {};

//Load databases.json and register databases into the database selection
//then load the first one
var jsonRequest = new XMLHttpRequest();
jsonRequest.open("GET",'databases.json',true);
jsonRequest.onreadystatechange = function() {
	if (jsonRequest.readyState === 4) {
		if (jsonRequest.status === 200 || jsonRequest.status === 0) {
			databases = JSON.parse(jsonRequest.responseText);
			d3.select('#database').selectAll('option')
				.data(databases)
				.enter().append('option')
					.attr('value',function(d,i){return i;})
					.text(function(d) {
						return d.name ? d.name: d.directory;
					});
			load();
		}
	}
}
jsonRequest.send(null);

//init margins and image size
updateResultMargins();
updateImageSize();

//Set up dragging on the resize bar
var resizeDrag = d3.drag()
	.on('start', function() {
		d3.select(this).attr('mode', 'dragging');
	})
	.on('drag', function() {
		var headerRect = d3.select('#header').node().getBoundingClientRect();
		var controlsRect = d3.select('#controlsArea').node().getBoundingClientRect();
		d3.select('#svgArea').style('height',(d3.event.y - headerRect.height - controlsRect.height)+'px');
		updateResultMargins();
		chart.updateSize();
	})
	.on('end', function() {
		d3.select(this).attr('mode', 'default');
	});
d3.select('#resizeBar').call(resizeDrag);

//Resize chart and update margins when window is resized
window.onresize = function(){
	if (loaded)
		chart.updateSize();
	updateResultMargins();
};

//*********
//END MAIN THREAD
//FUNCTION DEFINITIONS BELOW
//*********

function isValidFiletype(type) {
	if (!type)
		return false;
	var validFiletypes = ['JPG','JPEG','PNG','GIF'];
	type = type.trimLeft().trimRight();
	index = validFiletypes.indexOf(type.toUpperCase()); 

	return (index >= 0);
}

function getFileExtension(path) {
	return path ? path.substr(path.lastIndexOf('.')+1).trimRight() : undefined;
}

/**
 * Set the current database to the one selected in the database selection
 * and load it, replacing the chart with a new one
 */
function load() {
	var loaded = false;
	currentDb = databases[d3.select('#database').node().value];
	d3.select('#svgContainer').html('');
	chart = new ParallelCoordinatesChart(d3.select('#svgContainer'),
										currentDb.directory+'/'+'data.csv',
										currentDb.filter === undefined ? /^FILE/ : new RegExp(currentDb.filter),
										doneLoading);
	chart.smoothPaths = d3.select('#smoothLines').node().checked;
}

/**
 * Called when a database finishes loading.
 * Fills the sort selection with the new database's dimensions,
 * recreates custom path panel
 * and sets dispatch events
 */
function doneLoading() {
	loaded = true;

	fileDimensions = [];
	//Get image dimension. (First FILE dimension with a valid filetype)
	for (var i in chart.allDimensions) {
		var d = chart.allDimensions[i];
		if ((/^FILE/).test(d)) {
			fileDimensions.push(d);
		}
	}

	if (fileDimensions.length == 0) {
		d3.select('#controlsArea')
			.style('display','none');
		d3.selectAll('#resultsArea .resultView').remove();
		d3.select('#noFileWarning')
			.style('display','block');
		d3.select('.pageNav').remove();
		chart.dispatch.on("selectionchange", function(query) {
			d3.select('#selectionStats')
			.text(query.length+' out of '+chart.results.length+' results selected');
		})
	}
	else {
		d3.select('#controlsArea')
			.style('display','block');
		d3.select('#noFileWarning')
		.style('display','none');
		d3.select('#sort').html('').selectAll('option')
		.data(chart.dimensions)
		.enter().append('option')
			.attr('value',function(d){return d;})
			.text(function(d){return d;});
		chart.dispatch.on("selectionchange",onSelectionChange);
	}

	chart.overlayPathData[0] = customPath = {data: {}, style: "stroke-dasharray:20,10;"};
	chart.overlayPathData[1] = lowerBoundPath = {data: {}, style: "stroke-width:1px;stroke:pink;"};
	chart.overlayPathData[2] = upperBoundPath = {data: {}, style: "stroke-width:1px;stroke:pink;"};
	buildCustomControlPanel();

	updateResultMargins();
	
	chart.dispatch.on("mouseover",updateInfoPane);
}

/**
 * Toggle showing and hiding the custom path panel.
 */
function toggleShowHide() {
	showingCustomControls = !showingCustomControls;
	if (showingCustomControls) {//Show panel
		d3.select('#customControlPanel')
			.transition()
				.duration(500)
				.style('width','500px');
		d3.select('#svgArea')
			.transition()
				.duration(500)
				.style('padding-left','500px')
				.on('end',function(){chart.updateSize();})
				.on('start', function(){
					d3.select('#customPanelContents').style('display','initial');
					customPath.style = "opacity:1;stroke-dasharray:20,10;"
					upperBoundPath.style = "stroke-width:1px;opacity:1;stroke:pink;";
					lowerBoundPath.style = "stroke-width:1px;opacity:1;stroke:pink;";
					chart.updateOverlayPaths();
				});
		d3.select('#showHideLabel').text('<');
	}
	else {//Hide panel
		d3.select('#customControlPanel')
			.transition()
				.duration(500)
				.style('width','25px');
		d3.select('#svgArea')
			.transition()
				.duration(500)
				.style('padding-left','25px')
				.on('end',function(){
					chart.updateSize();
					d3.select('#customPanelContents').style('display','none');
				})
				.on('start',function() {
					customPath.style = "opacity:0;stroke-dasharray:20,10;";
					upperBoundPath.style = "stroke-width:1px;opacity:0;stroke:pink;";
					lowerBoundPath.style = "stroke-width:1px;opacity:0;stroke:pink;";
					chart.updateOverlayPaths();
				});
		d3.select('#showHideLabel').text('>');
	}
}

function updateSmoothLines() {
	var smooth = d3.select('#smoothLines').node().checked;
	if (loaded) {
		chart.smoothPaths = smooth;
		chart.paths.transition(1000).attr("d", function(d){return chart.getPath(d)});

		chart.highlightPath.transition(1000).attr('d',function() {
			var index = d3.select(this).attr('index');
			var path = d3.select('.resultPaths .resultPath[index="'+index+'"]');
			return path.attr('d');
		});

		chart.overlayPaths.selectAll('path').transition(1000)
			.attr('style', function(d) {return d.style})
			.attr('d', function(d) {return chart.getPath(d.data)});
	}
}

/**
 * Called when the selection in the chart changes.
 * Updates currentResults, sorts, and repopulates the results area
 */
function onSelectionChange(query) {
	d3.select('#selectionStats')
		.text(query.length+' out of '+chart.results.length+' results selected');

	currentResults = query.slice();//clone query
	var d = d3.select('#sort').node().value;
	currentResults.sort(function(a,b) {
		return chart.results[a][d] - chart.results[b][d];
	});
	updatePageNav();
	populateResults();
}

//Update the image size when the slider for it is moved
function updateImageSize() {
	var width = d3.select('#imageSize').node().value;
	d3.selectAll('.fileDisplay .display').style('width',width+'px');
	d3.select('#imageSizeLabel').text('Image Size: ' + width + 'px');
}

//Update the results per page when its changed
function updatePageSize() {
	if (loaded) {
		updatePageNav();
		populateResults();
	}
}

//Reorder the sample and repopulate the results when selected sort type changes
function updateSort() {
	if (loaded) {
		var d = d3.select('#sort').node().value;
		currentResults.sort(function(a,b) {
			return chart.getYPosition(d,chart.results[b]) -
					chart.getYPosition(d,chart.results[a]);
		});
		populateResults();
	}
}

//Empty and then refill the results area with resultViews for
//the current page of results
function populateResults() {
	var pageSize = d3.select('#pageSize').node().value;
	pageResults = currentResults.slice((currentPage-1)*pageSize,
								Math.min(currentPage*pageSize,currentResults.length));
	var views = d3.select('#resultsArea').selectAll('.resultView')
		.data(pageResults);
	views.exit().remove(); //remove unused resultViews
	views.enter() //add new resultViews
		.append('div').attr('class','resultView')
	.merge(views) //update
		.call(createResultViews);
}

//Called on a selection of resultViews to create their contents
//Assumes data has already been bound to selection
function createResultViews(selection) {
	//Set highlight on chart when mousing over
	selection
		.on('mouseenter',function(d) {
			chart.setHighlight(d);
			updateInfoPane(d, d3.event);
		})
		.on('mouseleave', function(d) {
			chart.setHighlight(null);
			updateInfoPane(null, d3.event);
		});
	
	//Bind list of files to each resultView
	//Create fileDisplays for each file
	selection.each(function(d) {
		var files = fileDimensions.map(function(dimension) {
			return chart.results[d][dimension];
		});
		var displays = d3.select(this).selectAll('.fileDisplay')
			.data(files);
		displays.exit().remove();
		displays.enter()
			.append('div').attr('class','fileDisplay')
		.merge(displays).html('')
			.call(createFileDisplays);
	});
}

//Called on a selection of fileDisplays to create their contents
//Assumes data has already been bound to selection
//Assumes incoming fileDisplays are empty
function createFileDisplays(selection) {
	selection.append('div')
		.attr('class','display')
		.style('width',d3.select('#imageSize').node().value+'px')
		.each(function(d) {
			//Create an image in the file display if the it is an image filetype
			if (isValidFiletype(getFileExtension(d))) {
				d3.select(this)
					.attr('content','image')
					.append('img')
						.attr('class','resultImg')
						.attr('src',currentDb.directory+'/'+d)
						.attr('width', '100%')
						.on('click',createModalImg)
			}
			//Otherwise create an error message
			else {
				d3.select(this)
					.attr('content','text')
					.append('div')
						.attr('class','resultErrorText')
						.text('Cannot display file: ' + d);
			}
		});

	//Create label at the bottom of display
	if (selection.selectAll('.displayLabel').empty())
		selection.append('div')
			.attr('class','displayLabel')
			.text(function(d,i) {return fileDimensions[i];});
}

//An event handler for an image to create modal
//when the image is clicked.
function createModalImg() {
	d3.select('body').append('div')
		.attr('class', 'modalBackground')
		.on('click', function() {
			//clicking the modal removes it
			d3.select(this).remove();
		})
		.append('img')
			.attr('class', 'modalImg')
			.attr('src',d3.select(this).attr('src'));
}

//Update the top margin of the result area according to the size of
//the header and svgArea
function updateResultMargins() {
	var topRect = d3.select('#top').node().getBoundingClientRect();
	d3.select('#resultsArea').style('margin-top',topRect.height+'px');
}

/**
 * Create the custom path panel
 */
function buildCustomControlPanel() {
	//Set maximum of threshold according to the number of dimensions
	var input = d3.select('#threshold');
	input.attr('max',d3.keys(chart.dimensions.filter(function(d) {
			return !chart.isStringDimension(d);
		})).length);
	//Clamp threshold to max
	if (Number(input.node().value)>Number(input.attr('max')))
		input.node().value = input.attr('max');
	//Create a customControlRow for each dimension
	d3.select('#customPanelContents').selectAll('div.customControlRow').remove();
	var rows = d3.select('#customPanelContents').selectAll('div.customControlRow')
		.data(chart.dimensions.filter(function(d) {
			return !chart.isStringDimension(d);
		}))
		.enter().append('div')
			.attr('class','customControlRow');
	//label
	rows.append('span')
		.text(function(d){return d;});
	//checkbox
	rows.append('input')
		.attr('type','checkbox')
		.on('input', function(d) {
			if (this.checked) {
				var slider = d3.select(this.parentNode)
							.select('input[type="range"]').node();
				slider.dispatchEvent(new Event('input'));
			}
			else {
				delete customPath.data[d];
				delete upperBoundPath.data[d];
				delete lowerBoundPath.data[d];
				updateThreshold();
				chart.updateOverlayPaths(true);
			}
		});
	//slider
	rows.append('input')
		.attr('type','range')
		.attr('min',0)
		.attr('max',100)
		.attr('step',1)
		.attr('value',50)
		.each(function(d) {
			this.scaleToDomain = d3.scaleLinear()
				.domain([0,100])
				.range(chart.y[d].domain());
		})
		.on('input', function(d) {
			var checkbox = d3.select(this.parentNode)
							.select('input[type="checkbox"]').node();
			if (!checkbox.checked)
				checkbox.checked = true;
			customPath.data[d] = this.scaleToDomain(this.value);
			updateThreshold();
			chart.updateOverlayPaths(true);
		});
}

/**
 * Called when the find similiar button is pressed.
 * Query for results similiar to the user-defined path
 * and set the selection to those similiar results
 */
function findSimiliar() {
	if (customPath.data != {}) {
		var threshold = Number(d3.select('#threshold').node().value);
		var similiar = chart.getSimiliar(customPath.data,
						threshold);
		if (similiar.length > 0)
			chart.setSelection(similiar);
		else
			alert("No similiar results found!");
	}
}

/**
 * Redraw the upper and lower bound paths according to changes
 * in the user-defined path or the threshold
 */
function updateThreshold() {
	var dims = chart.dimensions.filter(function(d) {
			return !isNaN(chart.results[0][d]);
	});
	var avgThreshold = Number(d3.select('#threshold').node().value)/d3.keys(customPath.data).length;
	dims.forEach(function(d) {
		var domain = chart.y[d].domain();
		var value = Number(customPath.data[d]);
		if (value) {
			var diff = Number(Math.abs(domain[0]-domain[domain.length-1])*avgThreshold);
			upperBoundPath.data[d] = Math.min(value+diff,domain[domain.length-1]);
			lowerBoundPath.data[d] = Math.max(value-diff,domain[0]);
			chart.updateOverlayPaths(true);
		}
	});
}

//Update the info pane according to the index of the data
//being moused over
function updateInfoPane(index, event) {
	var pane = d3.select('.infoPane');
	if (index != null && pane.empty()) {
		pane = d3.select('body').append('div')
			.attr('class', 'infoPane')
	}
	if (index != null) {
		pane.html(function() {
				var text = '<b>Index:<b> '+index+'<br>';
				var data = chart.results[index]
				for (i in data) {
					text += ('<b>'+i+':</b> ');
					text += (data[i] + '<br>');
				}
				return text;
			});
		//Draw the info pane in the side of the window opposite the mouse
		var leftHalf = (event.clientX <= window.innerWidth/2)
		if (leftHalf)
			pane.style('right', '30px');
		else
			pane.style('left', '30px');
	}
	else {
		d3.select('.infoPane').remove();
	}
}

//Recalculate the number of pages needed and rebuild the pageNav widget
function updatePageNav() {
	currentPage = 1;
	d3.select('.pageNav').remove();
	var pageSize = d3.select('#pageSize').node().value;
	if (currentResults.length > pageSize) {
		//create an array of page numbers to bind to pageNav widget
		var num = Math.floor(currentResults.length / pageSize);
		if (currentResults.length % pageSize > 0) {num++};
		var pageNums = [];
		for (var i = 0; i < num; i++){pageNums[i] = i+1};
		d3.select('body').append('ul').attr('class', 'pageNav')
			.selectAll('li')
			.data(pageNums)
			.enter()
				.append('li').attr('class','pageButton')
				.attr('mode', function(d) {d == 1 ? 'selected' : 'default'})
				.text(function(d) {return d})
				.on('click', function(d) {
					if (d3.select(this).attr('mode') != 'selected') {
						currentPage = d;
						d3.select('.pageButton[mode="selected"]').attr('mode','default');
						d3.select(this).attr('mode', 'selected');
						populateResults();
					}
				});

	}
}
