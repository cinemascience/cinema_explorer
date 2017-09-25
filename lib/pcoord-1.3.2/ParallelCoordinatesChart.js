/**
 * Based on Parallel Coordinates example by Mike Bostock and Jason Davies
 * 
 * Modified by Cameron Tauxe
 * Version: 1.3.2 (August 2, 2017)
 */

/**
 * Create a parallel coordinates chart inside the given parent element
 * and using the data from the given CSV file.
 * Ignores dimensions that are in the filter
 * Calls callback when done loading.
 */
function ParallelCoordinatesChart(parent, pathToCSV, filter, callback) {
	//Init instance variables
	this.parent = parent;
	this.pathToCSV = pathToCSV;

	//Sizing
	this.margin = {top: 30, right: 10, bottom: 10, left: 10};
	this.parentRect = parent.node().getBoundingClientRect();
	this.internalWidth = this.parentRect.width - this.margin.left - this.margin.right;
	this.internalHeight = this.parentRect.height - this.margin.top - this.margin.bottom;

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

	//An array of the indices of the currently selected results
	this.query;
	//An array of all the results (as objects)
	this.results;
	//An array of all the dimensions
	this.dimensions;
	this.filter = filter;

	var self = this;
	//Load the CSV file and build chart
	d3.csv(this.pathToCSV, function(error, results) {
		self.results = results;

		//Extract the list of dimensions and create a scale for each
		self.x.domain(self.dimensions = d3.keys(results[0]).filter(function(d) {
			return filter ? !self.filter.includes(d) : true;
		}));
		self.dimensions.forEach(function(d) {
			//Add an ordinal scale if values are NaN, otherwise, use a linear scale
			if (isNaN(results[0][d])) {
				var dif = self.internalHeight/results.length;
				self.y[d] = d3.scalePoint()
					.domain(results.map(function(p){return p[d];}))
					.range([self.internalHeight,0]);
			}
			else {
				self.y[d] = d3.scaleLinear()
					.domain(d3.extent(results, function(p){return +p[d];}))
					.range([self.internalHeight, 0]);
			}
		});

		//Create result Paths
		self.paths = self.svg.append("g")
			.attr("class", "resultPaths")
		.selectAll("path")
			.data(results)
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
					self.dimensions.sort(function(a, b) {
						return self.getPosition(a)-self.getPosition(b);
					});
					self.x.domain(self.dimensions);
					self.axes.attr("transform", function(d) {
						return "translate("+self.getPosition(d)+")";
					})
				})
				.on('end', function(d) {
					delete self.dragging[d];
					transition(d3.select(this)).attr("transform", "translate("+self.x(d)+")");
					transition(self.paths).attr('d',function(d){return self.getPath(d)})
					transition(self.highlightPath).attr('d',function() {
						return self.getPath(results[d3.select(this).attr('index')]);
					});
					transition(self.overlayPaths.selectAll('path')).attr('d', function(d) {
						return self.getIncompletePath(d.data)
					});
				}));
		
		//Add an axis and title.
		self.axes.append("g")
			.attr("class", "axis")
			.each(function(d) {d3.select(this).call(self.axis.scale(self.y[d]));})
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
 * represented by the given data point
 * (Skips over dimensions that are missing in data point)
 */
ParallelCoordinatesChart.prototype.getPath = function(d) {
	var self = this;
	var curveLength = this.smoothPaths ? this.internalWidth/this.dimensions.length/3 : 0;
	var path = '';
	this.dimensions.filter(function(p) {
		//do not include undefined values in determining path
		return d[p] != undefined;
	})
	.forEach(function(p,i) {
		var x = self.getPosition(p);
		var y = self.y[p](d[p]);
		if (i == 0) {//beginning of path
			path += ('M '+x+' '+y+' C ')+
					((x+curveLength)+' '+y+' ');
		}
		else if (i == self.dimensions.length-1) {//end of path
			path += ((x-curveLength)+' '+y+' ')+
					(x+' '+y+' ');
		}
		else {//midpoints
			path += ((x-curveLength)+' '+y+' ')+
					(x+' '+y+' ')+
					((x+curveLength)+' '+y+' ');
		}
	});
	return path;
};

/**
 * Get the path (the contents of the 'd' attribute) for the path
 * represented by the given data point.
 * Includes additonal logic to draw a physical break in the path
 * where dimensions are missing.
 */
ParallelCoordinatesChart.prototype.getIncompletePath = function(d) {
	var self = this;
	var curveLength = this.smoothPaths ? this.internalWidth/this.dimensions.length/3 : 0;
	var path = '';

	//Split dimensions into sections deliminated by missing dimensions
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

	sections.forEach(function(section) {
		if (section.length == 1) {
			var p = section[0];
			var x = self.getPosition(p);
			var y = self.y[p](d[p]);
			path += ('M '+(x-curveLength/2)+' '+y+' L ')+
					((x+curveLength/2)+' '+y);
		}
		else {
			section.forEach(function (p, i) {
				var x = self.getPosition(p);
				var y = self.y[p](d[p]);
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
ParallelCoordinatesChart.prototype.getPosition = function(d) {
	var v = this.dragging[d];
	return v == null ? this.x(d) : v;
};

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
				if (self.y[d].step) {//Determine if ordinal scale by whether step is exposed or not
					self.brushExtents[d] = d3.event.selection;
				}
				else {
					if (d3.event.selection != null)
						self.brushExtents[d] = d3.event.selection.map(self.y[d].invert,self.y[d]);
					else
						self.brushExtents[d] = null;
				}
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
				if (self.y[p].step) {//Determine if ordinal scale by whether step is exposed or not
					selected = selected && extent[0] <= self.y[p](d[p]) && self.y[p](d[p]) <= extent[1];
				}
				else
					selected = selected && extent[1] <= d[p] && d[p] <= extent[0];
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

	var self = this;

	//Rescale x scale
	this.x.range([0, this.internalWidth]).padding(1);

	//Rescale y scales
	this.dimensions.forEach(function(d) {
		self.y[d].range([self.internalHeight, 0]);
	});

	this.redrawPaths();

	//Reposition and rescale axes
	this.axes.attr("transform", function(d) {
						return "translate("+self.getPosition(d)+")";
					});
	this.axes.each(function(d) {
		d3.select(this).call(self.axis.scale(self.y[d]));
	});

	//Redraw brushes
	this.axes.selectAll('g.brush')
		.each(function(d) {
			self.y[d].brush
				.extent([[-8,0],[8,self.internalHeight]]);
			d3.select(this).call(self.y[d].brush);
			d3.select(this).call(self.y[d].brush.move, function() {
				if (self.brushExtents[d] == null) {return null;}
				if (self.y[d].step) {//Rescale extents for ordinal scales
					return self.brushExtents[d].map(function(i) {
						return i/oldHeight * self.internalHeight;
					})
				}
				else
					return self.brushExtents[d].map(self.y[d]);
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
		.attr('d', function(d) {return self.getIncompletePath(d.data)});
	if (!repressTransition)
		transition(paths)
			.attr('style', function(d) {return d.style})
			.attr('d', function(d) {return self.getIncompletePath(d.data)});
	else
		paths
			.attr('style', function(d) {return d.style})
			.attr('d', function(d) {return self.getIncompletePath(d.data)});
}

/**
 * Set the chart's selection to encapsulate the data represented by
 * the given array of indices
 */
ParallelCoordinatesChart.prototype.setSelection = function(selection) {
	var ranges = {};
	var self = this;
	this.dimensions.filter(function(d) {
		return !isNaN(self.results[0][d]);
	})
	.forEach(function(d) {
		var min = Number(self.results[selection[0]][d]);
		var max = min;
		selection.forEach(function(i) {
			var val = Number(self.results[i][d]);
			if (val > max) {max = val;}
			if (val < min) {min = val;}
		});
		ranges[d] = [max,min];
	});
	this.axes.selectAll('g.brush')
		.each(function(d) {
			if (ranges[d]) {
				d3.select(this).call(self.y[d].brush.move, function() {
					return [self.y[d](ranges[d][0])-5,
							self.y[d](ranges[d][1])+5];
				})
			}
		});
	this.brush();
}

/**
 * Get results (returned as an array of indices) that are similiar to the
 * given data.
 * Given data does not need to include every dimension. Missing dimensions are
 * simply ignored, but every dimension included must be numeric.
 * Threshold is the maximum difference for results to be included.
 * Difference is measured as the Manhattan distance where each dimension is normalized.
 * i.e: The sum of the differences on each dimensions (scaled from 0 to 1.0).
 */
ParallelCoordinatesChart.prototype.getSimiliar = function(data, threshold) {
	var self = this;
	var similiar = [];
	this.paths.each(function(p,i) {
		var dist = 0;//manhattan distance (each dimension is normalized)
		for (d in data) {
			var max = Number(self.y[d].domain()[self.y[d].domain().length-1]);
			dist += Math.abs(Number(data[d])/max-Number(p[d])/max);
		}
		if (dist <= threshold) {
			similiar.push(i);
		}
	})
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
		.attr('d', function(d) {return self.getIncompletePath(d.data)});
}

//Convenience functions

function brushstart() {
	d3.event.sourceEvent.stopPropagation();
}

function transition(g) {
	return g.transition().duration(500);
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
