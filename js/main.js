/*
A general Parallel Coordinates-based viewer for Spec-D cinema databases 

pcoord_viewer Version 1.7

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
var databaseInfo;//An array of the databases as defined in databases.json
var currentDbInfo //Info for the currently selected database as defined in databases.json
var currentDb;//The currently loaded database
var hasAxisOrdering = false; //whether or not the currentDb has extra axis ordering data

var loaded = false;

//Components
var pcoord;//The Parallel Coordinates Chart
var view; //The component for viewing selected results
var query; //The component for querying results

//View type enum
var viewType = Object.freeze({
	IMAGESPREAD: 0,
	SCATTERPLOT: 1
});
var currentView = viewType.IMAGESPREAD;

//State of the slideOut Panel
var slideOutOpen = false;

//Load databases.json and register databases into the database selection
//then load the first one
var jsonRequest = new XMLHttpRequest();
jsonRequest.open("GET",'databases.json',true);
jsonRequest.onreadystatechange = function() {
	if (jsonRequest.readyState === 4) {
		if (jsonRequest.status === 200 || jsonRequest.status === 0) {
			databaseInfo = JSON.parse(jsonRequest.responseText);
			d3.select('#database').selectAll('option')
				.data(databaseInfo)
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
updateViewContainerSize();

//Set up dragging on the resize bar
var resizeDrag = d3.drag()
	.on('start', function() {
		d3.select(this).attr('mode', 'dragging');
	})
	.on('drag', function() {
		var headerRect = d3.select('#header').node().getBoundingClientRect();
		d3.select('#pcoordArea').style('height',(d3.event.y - headerRect.height)+'px');
		//updateResultMargins();
		updateViewContainerSize();
		pcoord.updateSize();
		view.updateSize();
	})
	.on('end', function() {
		d3.select(this).attr('mode', 'default');
	});
d3.select('#resizeBar').call(resizeDrag);

//Resize chart and update margins when window is resized
window.onresize = function(){
	if (loaded) {
		pcoord.updateSize();
		updateViewContainerSize();
		view.updateSize();
	}
};

//*********
//END MAIN THREAD
//FUNCTION DEFINITIONS BELOW
//*********

/**
 * Set the current database to the one selected in the database selection
 * and load it, replacing the chart with a new one
 */
function load() {
	loaded = false;

	//Remove old components
	if (window.chart) {chart.destroy();}
	if (window.view) {view.destroy();}
	if (window.query) {query.destroy();}

	//Remove axisOrdering panel if it exists
	if (hasAxisOrdering) {
		d3.select('#axisOrderPanel').remove();
	}
	hasAxisOrdering = false;

	currentDbInfo = databaseInfo[d3.select('#database').node().value];
	currentDb = new CINEMA_COMPONENTS.Database(currentDbInfo.directory,doneLoading,loadingError);
}

/**
 * Called if an error was found when loading the database
 */
function loadingError(error) {
	window.alert(error);
}

/**
 * Called when a database finishes loading.
 * Builds components
 * and sets up event listeners
 */
function doneLoading() {
	loaded = true;

	pcoord = new CINEMA_COMPONENTS.PcoordSVG(d3.select('#pcoordContainer').node(),
		currentDb,
		currentDbInfo.filter === undefined ? /^FILE/ : new RegExp(currentDbInfo.filter));
	pcoord.smoothPaths = d3.select('#smoothLines').node().checked;

	if (currentView == viewType.IMAGESPREAD)
		view = new CINEMA_COMPONENTS.ImageSpread(d3.select('#viewContainer').node(),currentDb);
	else if (currentView == viewType.SCATTERPLOT)
		view = new CINEMA_COMPONENTS.ScatterPlotSVG(d3.select('#viewContainer').node(),currentDb,
			currentDbInfo.filter === undefined ? /^FILE/ : new RegExp(currentDbInfo.filter));

	query = new CINEMA_COMPONENTS.Query(d3.select('#queryContainer').node(),currentDb);

	//When selection in pcoord chart changes, set readout
	//and update view component
	pcoord.dispatch.on('selectionchange',function(selection) {
		d3.select('#selectionStats')
			.text(selection.length+' out of '+currentDb.data.length+' results selected');
		view.setSelection(selection);
	});

	//Set mouseover handler for pcoord and views component
	pcoord.dispatch.on("mouseover",handleMouseover);
	view.dispatch.on('mouseover',handleMouseover);

	//Set styles for query data
	query.custom.style = "stroke-dasharray:20,7;stroke-width:3px;stroke:red";
	query.lower.style = "stroke-dasharray:initial;stroke-width:2px;stroke:pink;";
	query.upper.style = "stroke-dasharray:initial;stroke-width:2px;stroke:pink;";
	//Add query data as overlays to pcoord chart
	pcoord.setOverlayPaths([query.custom,query.upper,query.lower]);

	//Set pcoord chart to repond to change in query data
	query.dispatch.on('customchange',function(newData) {
		pcoord.redrawOverlayPaths();
	});

	//Set pcoord query to respond to a query
	query.dispatch.on('query',function(results) {
		pcoord.setSelection(results);
	})

	//Update size now that components are built
	updateViewContainerSize();
	view.updateSize();

	//Trigger initial selectionchange event
	pcoord.dispatch.call('selectionchange',pcoord,pcoord.selection);

	if (currentDb.hasAxisOrdering) {
		hasAxisOrdering = true;
		buildAxisOrderPanel();
	}
}

/**
 * Open or close the slideOut Panel
 */
function toggleShowHide() {
	slideOutOpen = !slideOutOpen;
	if (slideOutOpen) { //slide out
		d3.select('#slideOut').transition()
			.duration(500)
			.style('width','500px')
			.on('start',function(){
				d3.select('#slideOutContents').style('display','initial');
				pcoord.setOverlayPaths([query.custom,query.upper,query.lower]);
			})
			.on('end',function() {
				query.updateSize();
			});
		d3.select('#pcoordArea').transition()
			.duration(500)
			.style('padding-left','500px')
			.on('end',function(){pcoord.updateSize();})
		d3.select('#showHideLabel').text('<');
	}
	else { //slide in
		d3.select('#slideOut').transition()
			.duration(500)
			.style('width','25px')
			.on('start',function(){
				pcoord.setOverlayPaths([]);
			})
			.on('end',function(){
				d3.select('#slideOutContents').style('display','hidden');
				query.updateSize();
			});
		d3.select('#pcoordArea').transition()
			.duration(500)
			.style('padding-left','25px')
			.on('end',function(){pcoord.updateSize();})
		d3.select('#showHideLabel').text('>');
	}

}

/**
 * Change the view component to the specified viewType
 */
function changeView(type) {
	if (loaded && type != currentView) {
		currentView = type;
		view.destroy();
		if (currentView == viewType.IMAGESPREAD) {
			view = new CINEMA_COMPONENTS.ImageSpread(d3.select('#viewContainer').node(),currentDb);
			d3.select('#imageSpreadTab').attr('selected','selected');
			d3.select('#scatterPlotTab').attr('selected','default');
		}
		else if (currentView == viewType.SCATTERPLOT) {
			view = new CINEMA_COMPONENTS.ScatterPlotSVG(d3.select('#viewContainer').node(),currentDb,
				currentDbInfo.filter === undefined ? /^FILE/ : new RegExp(currentDbInfo.filter));
			d3.select('#scatterPlotTab').attr('selected','selected');
			d3.select('#imageSpreadTab').attr('selected','default');
		}
		view.dispatch.on('mouseover',handleMouseover);
		updateViewContainerSize();
		view.updateSize();
		view.setSelection(pcoord.selection);
	}
}

/**
 * Build a panel for selecting axis orderings
 * Add listeners for pcoord chart
 */
function buildAxisOrderPanel() {
	//Add panel
	var axisOrderPanel = d3.select('#header').append('div')
		.attr('id','axisOrderPanel');
	//Add label
	axisOrderPanel.append('span')
		.attr('id','axisOrderLabel')
		.text("Axis Order:");
	axisOrderPanel.append('br');
	//Add select for category
	axisOrderPanel.append('select')
		.attr('id','axis_category')
		.selectAll('option').data(d3.keys(currentDb.axisOrderData))
			.enter().append('option')
				.attr('value',function(d){return d;})
				.text(function(d){return d;});
	//Set onchange for category select to populate value select
	d3.select('#axis_category').on('change',function() {
		var category = currentDb.axisOrderData[this.value];
		var val = d3.select('#axis_value').selectAll('option')
			.data(d3.range(-1,category.length));//-1 is 'custom' order
		val.exit().remove();
		val.enter().append('option')
			.merge(val)
				.attr('value',function(d){return d;})
				.text(function(d){return d == -1 ? 'Custom' : category[d].name;});
		//set onchange for value select to change order in pcoord chart
		d3.select('#axis_value').on('change',function() {
			if (this.value != -1) {
				var order = category[this.value].order;
				pcoord.setAxisOrder(order);
			}
		});
		d3.select('#axis_value').node().value = -1; //set to custom
	});
	//Add spacer
	axisOrderPanel.append('span').text(' : ');
	//Add value select
	axisOrderPanel.append('select')
		.attr('id','axis_value');

	//Add handler to pcoord chart to set value select to "custom" 
	//when axis order is manually changed
	pcoord.dispatch.on('axisorderchange',function() {
		d3.select('#axis_value').node().value = -1;
	});

	//trigger change in category to populate value select
	d3.select('#axis_category').on('change').call(d3.select('#axis_category').node());
}

/**
 * Respond to smoothLines checkbox.
 * Update lines in pcoord chart
 */
function updateSmoothLines() {
	if (loaded) {
		pcoord.smoothPaths = d3.select('#smoothLines').node().checked;
		pcoord.redrawPaths();
	}
}

/**
 * Update the size of viewContainer to fill the remaining space below the top panel
 **/
function updateViewContainerSize() {
	var topRect = d3.select('#top').node().getBoundingClientRect();
	var tabRect = d3.select('#tabContainer').node().getBoundingClientRect();
	d3.select('#viewContainer').style('height',window.innerHeight-topRect.height-tabRect.height+'px');
}

//Respond to mouseover event.
//Set highlight in pcoord chart
//and update info pane
function handleMouseover(index, event) {
	if (index != null) {
		pcoord.setHighlightedPaths([index]);
		if (currentView == viewType.SCATTERPLOT)
			view.setHighlightedPoints([index]);
	}
	else {
		pcoord.setHighlightedPaths([]);
		if (currentView == viewType.SCATTERPLOT)
			view.setHighlightedPoints([]);
	}
	updateInfoPane(index,event);
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
				var data = currentDb.data[index]
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
