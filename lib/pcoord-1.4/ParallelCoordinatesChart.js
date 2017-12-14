/*
A general Parallel Coordinates-based viewer for Spec-D cinema databases 

chart Version 1.4

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

This is based on the example of the Nutrient Explorer, copyright 2012, Kai
Chang, and is licensed appropriately.
*/

/**
 * Create a parallel coordinates chart inside the given parent element
 * and using the data from the given CSV file.
 * Dimensions whose name match the filterRegex are not shown on the chart
 * Calls callback when done loading.
 */
function ParallelCoordinatesChart(parent, pathToCSV, filterRegex, callback) {
	//Init instance variables
	this.parent = parent;
	this.pathToCSV = pathToCSV;
	this.filterRegex = filterRegex;

	//Sizing
	this.margin = {top: 30, right: 10, bottom: 10, left: 10};
	this.parentRect = parent.node().getBoundingClientRect();
	this.internalWidth = this.parentRect.width - this.margin.left - this.margin.right;
	this.internalHeight = this.parentRect.height - this.margin.top - this.margin.bottom;
	this.NaNMargin = this.internalHeight/11; // the room left for NaN values at the bottom of the chart

	//Event handling
	this.dispatch = d3.dispatch("selectionchange","mouseover","click");

	//xScale
	this.x = d3.scalePoint().range([0, this.internalWidth]).padding(1);
	//yScales (one for each dimension)
	this.y = {};
	//keeps track of which dimension is being dragged
	this.dragging = {};
	//shortcut for creating axes
	this.axis = d3.axisLeft();
	//paths
	this.paths;
	this.highlightPath;
	this.overlayPaths;
	this.smoothPaths = true;
	//data for overlay paths
	//overlayPathData is an array of objects (one for each path) formatted like so:
	// {data: (data_to_draw_path_from), style: (style_attribute)}
	this.overlayPathData= [];
	//Axes selection
	this.axes;
	//Range covered by each brush
	this.brushExtents = {};

	//Create svg
	this.svg = parent.append('svg')
		.attr("class", "pCoordChart")
		.attr('viewBox',(-this.margin.right)+' '+(-this.margin.top)+' '+
						(this.parentRect.width)+' '+
						(this.parentRect.height))
		.attr('preserveAspectRatio','none')
		.attr('width','100%')
		.attr('height','100%');

	//Add Loading/Error message
	this.message = this.svg.append('text')
		.attr('class','pCoordChart errorMessage')
		.text("Loading...");

	//An array of the indices of the currently selected results
	this.query;
	//An array of all the results (as objects)
	this.results;
	//An array of all dimensions
	this.allDimensions = [];
	//An array of all dimensions excluding the ones filtered out by filterRegex
	this.dimensions = [];

	var self = this;
	//Load the CSV file and build chart
	getAndParseCSV(this.pathToCSV, function(data) {
		var error = self.checkErrors(data);
		if (error) {
			self.message.text("ERROR: " + error);
			return;
		}
		else
			self.message.remove();

		self.allDimensions = data[0];
		//convert results from arrays to objects
		self.results = data.slice(1).map(function(d) {
			var obj = {};
			self.allDimensions.forEach(function(p,i) {obj[p] = d[i];});
			return obj;
		});
		//filter out dimensions that match the filterRegex (exclude them from the chart)
		self.dimensions = self.allDimensions.filter(function(d) {
			return filterRegex ? !filterRegex.test(d) : true;
		});

		//Create a scale for each dimension
		self.x.domain(self.dimensions);
		self.dimensions.forEach(function(d) {
			//If the dimension is a float or integer type, create a linear scale
			//If the value is the text "NaN," (not case sensitive) then it counts as a float type
			if (!isNaN(self.results[0][d]) || self.results[0][d].toUpperCase() === "NAN") {
				self.y[d] = d3.scaleLinear()
					.domain(d3.extent(self.results, function(p){return +p[d];}))
					.range([self.internalHeight-self.NaNMargin,0]);
			}
			//otherwise, the dimension is a string type so create a point scale
			else {
				self.y[d] = d3.scalePoint()
					.domain(self.results.map(function(p){return p[d];}))
					.range([self.internalHeight,0]);

			}
		});

		//Create result Paths
		self.paths = self.svg.append("g")
			.attr("class", "resultPaths")
		.selectAll("path")
			.data(self.results)//bind paths to results
		.enter().append("path")
			.attr('class', 'resultPath')
			.attr("index", function(d,i){return i})
			.attr("d", function(d){return self.getPath(d)})
			.on('mouseenter', function(d,i) {
				self.setHighlight(i);
				self.dispatch.call("mouseover",self,i,d3.event)
			})
			.on('mouseleave', function(d,i) {
				self.setHighlight(null);
				self.dispatch.call("mouseover",self,null,d3.event)
			})
			.on('click', function(d,i) {
				self.dispatch.call("click",self,i);
			});
		//Create highlightPath (hidden by default)
		self.highlightPath = self.svg.append('path')
			.attr('class', 'highlightPath')
			.attr('index',0)
			.attr('style', "display:none;")
		//Create group for overlay paths
		self.overlayPaths = self.svg.append('g')
			.attr('class', "overlayPaths");

		//Add a group element for each dimension
		self.axes = self.svg.selectAll('.dimension')
			.data(self.dimensions)
		.enter().append('g')
			.attr('class', 'dimension')
			.attr('transform', function(d) {
				return "translate("+self.x(d)+")";
			})
			//Set-up dragging for each axis
			.call(d3.drag()
				.subject(function(d){return {x: self.x(d)};})
				.on('start', function(d) {
					self.dragging[d] = self.x(d);
				})
				.on('drag', function(d) {
					self.dragging[d] = Math.min(self.internalWidth, Math.max(0,d3.event.x));
					self.redrawPaths();
					self.dimensions.sort(function(a,b) {
						return self.getXPosition(a)-self.getXPosition(b);
					});
					self.x.domain(self.dimensions);
					self.axes.attr("transform", function(d) {
						return "translate("+self.getXPosition(d)+")";
					})
				})
				.on('end', function(d) {
					delete self.dragging[d];
					transition(d3.select(this)).attr("transform", "translate("+self.x(d)+")");
					transition(self.paths).attr('d',function(d){return self.getPath(d)})
					transition(self.highlightPath).attr('d',function() {
						return self.getPath(self.results[d3.select(this).attr('index')]);
					});
					transition(self.overlayPaths.selectAll('path')).attr('d', function(d) {
						return self.getPath(d.data)
					});
				}));
		
		//Add an axis and title.
		self.axes.append("g")
			.attr("class", "axis")
			.each(function(d) {
					d3.select(this).call(self.axis.scale(self.y[d]));
					if (!self.isStringDimension(d)) {//if scale is linear, then extend the axis to show NaN
						d3.select(this).append('path')
							.attr('class','NaNExtension')
							.attr('d',"M0.5,"+String(self.internalHeight-self.NaNMargin+0.5)+"V"+String(self.internalHeight-0.5));
						var NaNTick = d3.select(this).append('g')
							.attr('class','NaNExtensionTick')
							.attr('transform',"translate(0,"+String(self.internalHeight-0.5)+")");
						NaNTick.append('line')
							.attr('x2','-6');
						NaNTick.append('text')
							.attr('x','-9')
							.attr('dy','0.32em')
							.text('NaN');
					}
				})
		.append("text")
			.style("text-anchor", "middle")
			.attr("y", -9)
			.text(function(d) {return d;});

		//Add and store a brush for each axis
		self.axes.append("g")
			.attr("class", "brush")
			.each(function(d) {
				d3.select(this).call(self.y[d].brush = d3.brushY()
										.extent([[-8,0],[8,self.internalHeight]])
										.on('start', brushstart)
										.on('start brush',function(){return self.brush()}));
			})
			.selectAll("rect")
				.attr('x', -8)
				.attr('width', 16);

		if (callback)
			callback();
		self.brush();
	});
}

/**
 * Get the path (the contents of the 'd' attribute) for the path
 * represented by the given data point.
 * Draws a physical break in the path where values are undefined.
 */
ParallelCoordinatesChart.prototype.getPath = function(d) {
	var self = this;
	var curveLength = this.smoothPaths ? this.internalWidth/this.dimensions.length/3 : 0;
	var singleSegmentLength = this.internalWidth/this.dimensions.length/3;
	var path = '';

	//Split dimensions into sections deliminated by undefined values
	var sections = [];
	var currentSection = [];
	this.dimensions.forEach(function(p) {
		if (d[p] != undefined) {
			currentSection.push(p);
		}
		else if (currentSection.length != 0) {
			sections.push(currentSection.slice());
			currentSection = [];
		}
	});
	if (currentSection.length > 0)
		sections.push(currentSection.slice());

	//Draw individual sections
	sections.forEach(function(section) {
		//If a section contains only one dimension, draw a short line across the axis
		if (section.length == 1) {
			var p = section[0];
			var x = self.getXPosition(p);
			var y = self.getYPosition(p,d);
			path += ('M '+(x-singleSegmentLength/2)+' '+y+' L ')+
					((x+singleSegmentLength/2)+' '+y);
		}
		else {
			section.forEach(function (p,i) {
				var x = self.getXPosition(p);
				var y = self.getYPosition(p,d);
				if (i == 0) {//beginning of path
					path += ('M '+x+' '+y+' C ')+
							((x+curveLength)+' '+y+' ');
				}
				else if (i == section.length-1) {//end of path
					path += ((x-curveLength)+' '+y+' ')+
							(x+' '+y+' ');
				}
				else {//midpoints
					path += ((x-curveLength)+' '+y+' ')+
							(x+' '+y+' ')+
							((x+curveLength)+' '+y+' ');
				}
			});
		}
	});
	return path;
}

/**
 * Get the x-coordinate of the axis representing the given dimension
 */
ParallelCoordinatesChart.prototype.getXPosition = function(d) {
	var v = this.dragging[d];
	return v == null ? this.x(d) : v;
};

/**
 * Get the y-coordinate of the line for data point p on dimension d
 */
ParallelCoordinatesChart.prototype.getYPosition = function(d, p) {
	if (!this.isStringDimension(d) && isNaN(p[d]))
		//If the value is NaN on a linear scale, return internalHeight as the position (to place the line on the NaN tick)
		return this.internalHeight;
	return this.y[d](p[d]);
}

/**
 * Handle brush events. Select paths and update query
 */
ParallelCoordinatesChart.prototype.brush = function() {
	var self = this;

	//If this called due to a brush event (as opposed to manually called)
	//Update the corresponding brushExtent
	if (d3.event != null) {
		this.dimensions.forEach(function(d) {
			if (d3.event.target==self.y[d].brush) {
				self.brushExtents[d] = d3.event.selection;

				//Ignore brush if its start and end coordinates are the same
				if (self.brushExtents[d] != null && self.brushExtents[d][0] === self.brushExtents[d][1])
					self.brushExtents[d] = null;
			}
		});
	}

	//Iterate through paths and determine if each is selected
	//by checking that it is within the extent of each brush
	var newQuery = [];
	this.paths.each(function(d, i) {
		var selected = true;
		for (p in self.brushExtents) {
			var extent = self.brushExtents[p];
			if (extent != null) {
				var y = self.getYPosition(p,d);
				selected = selected && extent[0] <= y && y <= extent[1];
			}
			//Ignore dimensions where extents are not set
			else
				selected = selected && true;
		}
		d3.select(this).attr('mode', selected ? 'active' : 'inactive');
		if (selected)
			newQuery.push(i);
	});
	if (!arraysEqual(this.query, newQuery)) {
		this.query = newQuery;
		this.dispatch.call("selectionchange",this, this.query);
	}
};

/**
 * Redraw the chart to fit the size of its parent
 * (call this whenever its parent changes size)
 */
ParallelCoordinatesChart.prototype.updateSize = function() {
	var oldHeight = this.internalHeight;//old height needed to rescale brushes on ordinal scales

	//Recalculate dimensions
	this.parentRect = this.parent.node().getBoundingClientRect();
	this.internalWidth = this.parentRect.width - this.margin.left - this.margin.right;
	this.internalHeight = this.parentRect.height - this.margin.top - this.margin.bottom;
	this.svg.attr('viewBox',
						(-this.margin.right)+' '+
						(-this.margin.top)+' '+
						(this.parentRect.width)+' '+
						(this.parentRect.height));
	this.NaNMargin = this.internalHeight/11;
	var self = this;

	//Rescale x scale
	this.x.range([0, this.internalWidth]).padding(1);

	//Rescale y scales
	this.dimensions.forEach(function(d) {
		self.y[d].range([self.isStringDimension(d) ? self.internalHeight : self.internalHeight-self.NaNMargin, 0]);
	});

	this.redrawPaths();

	//Reposition and rescale axes
	this.axes.attr("transform", function(d) {
						return "translate("+self.getXPosition(d)+")";
					});
	this.axes.each(function(d) {
		d3.select(this).call(self.axis.scale(self.y[d]));
		if (!self.isStringDimension(d)) {//if scale is linear, then update the NaN extension on the axis
			d3.select(this).select('path.NaNExtension')
				.attr('d',"M0.5,"+String(self.internalHeight-self.NaNMargin+0.5)+"V"+String(self.internalHeight-0.5));
			d3.select(this).select('.NaNExtensionTick')
				.attr('transform',"translate(0,"+String(self.internalHeight-0.5)+")");
		}
	});

	//Redraw brushes
	this.axes.selectAll('g.brush')
		.each(function(d) {
			self.y[d].brush
				.extent([[-8,0],[8,self.internalHeight]]);
			d3.select(this).call(self.y[d].brush);
			d3.select(this).call(self.y[d].brush.move, function() {
				if (self.brushExtents[d] == null) {return null;}

				return self.brushExtents[d].map(function(i) {
					return i/oldHeight * self.internalHeight;
				});
			});
		})
}

/**
 * Highlight the path with the given index
 * Make index null to remove the highlight
 */
ParallelCoordinatesChart.prototype.setHighlight = function(index) {
	if (index != null) {
		this.highlightPath
			.attr('index',index)
			.attr('d',
				d3.select('.resultPaths .resultPath[index="'+index+'"]').attr('d'))
			.attr('style',"display:initial;");
	}
	else {
		this.highlightPath
			.attr('style',"display:none;");
	}
}

/**
 * Update the overlay paths according to overlayPathData.
 * Append new paths, remove removed ones, transition ones that stay.
 * 
 * overlayPathData is an array of objects (one for each path) formatted like so:
 * {data: (data_to_draw_path_from), style: (style_attribute)}
 * 
 * The path data does not need to include every dimension. Missing dimensions will
 * be skipped over.
 */
ParallelCoordinatesChart.prototype.updateOverlayPaths =function(repressTransition) {
	var self = this;
	var paths = this.overlayPaths.selectAll('path').data(this.overlayPathData);
	paths.exit().remove()
	paths.enter()
		.append('path')
		.attr('class','overlayPath')
		.attr('style', function(d) {return d.style})
		.attr('d', function(d) {return self.getPath(d.data)});
	if (!repressTransition)
		transition(paths)
			.attr('style', function(d) {return d.style})
			.attr('d', function(d) {return self.getPath(d.data)});
	else
		paths
			.attr('style', function(d) {return d.style})
			.attr('d', function(d) {return self.getPath(d.data)});
}

/**
 * Set the chart's selection to encapsulate the data represented by
 * the given array of indices
 */
ParallelCoordinatesChart.prototype.setSelection = function(selection) {
	var ranges = {};
	var self = this;
	this.dimensions.forEach(function(d) {
		ranges[d] = d3.extent(selection, function(i) {
			return self.getYPosition(d, self.results[i]);
		});
	});
	this.axes.selectAll('g.brush')
		.each(function(d) {
			d3.select(this).call(self.y[d].brush.move, function() {
				return [ranges[d][0]-5,ranges[d][1]+5];
			});
		});
	this.brush();
}

/**
 * Get results (returned as an array of indices) that are similiar to the
 * given data.
 * Threshold is the maximum difference for results to be included.
 * Difference is measured as the Manhattan distance where each dimension is normalized.
 * i.e: The sum of the differences on each dimensions (scaled from 0 to 1.0).
 */
ParallelCoordinatesChart.prototype.getSimiliar = function(data, threshold) {
	var self = this;
	var similiar = [];
	this.results.forEach(function(p,i) {
		var dist = 0;//manhattan distance (each dimension is normalized)
		self.dimensions.forEach(function(d) {
			if (data[d] !== undefined) {
				if (self.isStringDimension(d))
					//If a string scale, make distance 0 if values are the same, otherwise 1
					dist += (p[d] == data[d] ? 0 : 1);
				else {
					//NaN values have 0 distance from each other, but 1 from anything else
					if (isNaN(data[d]))
						dist += (isNaN(p[d]) ? 0 : 1);
					//undefined values have a distance of 1 from defined values
					else if (p[d] === undefined)
						dist += 1;
					else
						dist += Math.abs(self.getYPosition(d,p)-self.getYPosition(d,data))/self.internalHeight;
				}
			}
			//two undefined values have a distance of 0 from each other
			else if (p[d] === undefined)
				dist += 0;
		});
		if (dist <= threshold) {
			similiar.push(i);
		}
	});
	return similiar;
}

/**
 * Redraw result paths, the highlight path and overlay paths
 */
ParallelCoordinatesChart.prototype.redrawPaths = function() {
	var self = this;
	this.paths.attr("d", function(d){return self.getPath(d)});

	this.highlightPath
		.attr('d',function() {
			var index = d3.select(this).attr('index');
			var path = d3.select('.resultPaths .resultPath[index="'+index+'"]');
			return path.attr('d');
		});

	this.overlayPaths.selectAll('path')
		.attr('style', function(d) {return d.style})
		.attr('d', function(d) {return self.getPath(d.data)});
}

/**
 * Check for critical errors in the given data.
 * Returns an error message if an error was found.
 * Doesn't return anything if no errors were found.
 */
ParallelCoordinatesChart.prototype.checkErrors = function(data) {
	//Check that there are at least two lines of data
	if (data.length < 2)
		return "The first and second lines in the file are required.";

	//Check that there are no empty values in the first two rows
	var emptyValFound = false;
	for (var i in data[0])
		emptyValFound = emptyValFound && (data[0][i] === undefined);
	for (var i in data[1])
		emptyValFound = emptyValFound && (data[1][i] === undefined);
	if (emptyValFound)
		return "Empty values may not occur in the header (first line) or first data row (second line).";

	//Check that all rows of data have the same length
	var testLength = data[0].length;
	for (var i in data)
		if (data[i].length != testLength)
			return "Each line must have an equal number of comma separated values (columns). "+
					"Is there a stray newline at the end of the file?";
}

//Convenience functions

function brushstart() {
	d3.event.sourceEvent.stopPropagation();
}

function transition(g) {
	return g.transition().duration(500);
}

ParallelCoordinatesChart.prototype.isStringDimension = function(d) {
	return Boolean(this.y[d].step);
}

/**
 * Convenience function to compare arrays
 * (used to compare the query to the previous query)
 */
function arraysEqual(a, b) {
	if (a === b) return true;
	if (a == null || b == null) return false;
	if (a.length != b.length) return false;

	for (var i = 0; i < a.length; ++i) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

/*
* Parse the text of a csv file into a 2 dimensional array.
* Distinguishes between empty strings and undefined values
*
* Use this instead of d3's parser which counts undefined values as empty strings
*
* Based on example code from Ben Nadel
* https://www.bennadel.com/blog/1504-ask-ben-parsing-csv-strings-with-javascript-exec-regular-expression-command.htm
*/
function parseCSV(csvText) {
	//               (delimiter)     (quoted value)           (value)
	var csvRegex = /(\,|\r?\n|\r|^)(?:"([^"]*(?:""[^"]*)*)"|([^\,\r\n]*))/gi;
	var data = [];
	var matches;
	//If text is empty, stop now. Otherwise will get caught in infinite loop
	if (csvText === "")
		return data;
	while (matches = csvRegex.exec(csvText)) {
		 //Newline,beginning of string, or a comma
		var delimiter = matches[1];
		//If the value is in quotes, it will be here (without the outside quotes)
		var quotedValue = matches[2];
		//If the value wasn't in quotes, it will be here
		var value = matches[3];

		//If the deilimiter is not a comma (meaning its a new line),
		//add a row to the data
		if (delimiter != ',')
			data.push([]);
		//If a quoted value, escape any pairs of quotes and add to data
		if (quotedValue !== undefined)
			data[data.length-1].push(quotedValue.replace(/""/g,"\""));
		//If an unquoted value, escape any pairs of quotes add to data, or undefined if empty
		else
			data[data.length-1].push(value === "" ? undefined : value.replace(/""/g,"\""));
	}
	return data;
}

/*
* Get the specified CSV file, parse it, and call callback with the data when done
*/
function getAndParseCSV(path,callback) {
	var request = new XMLHttpRequest();
	request.open("GET",path,true);
	request.onreadystatechange = function() {
		if (request.readyState === 4) {
			if (request.status === 200 || request.status === 0) {
				var data = parseCSV(request.responseText);
				if (callback)
					callback(data);
			}
		}
	}
	request.send(null);
}
